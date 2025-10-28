import subprocess
import json
import tempfile
import os
from typing import Dict, List, Any

class CodeLinter:
    """Multi-language code linting and error checking"""
    
    def __init__(self):
        self.linters = {
            'python': self._lint_python,
            'javascript': self._lint_javascript,
        }
    
    def lint_code(self, code: str, language: str, filename: str = None) -> Dict[str, Any]:
        """Lint code and return errors/warnings"""
        try:
            if language not in self.linters:
                return {
                    "success": False,
                    "message": f"Linting not supported for {language}",
                    "errors": []
                }
            
            # Use appropriate linter
            errors = self.linters[language](code, filename or f"temp.{self._get_extension(language)}")
            
            return {
                "success": True,
                "errors": errors,
                "count": len(errors),
                "language": language
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Linting error: {str(e)}",
                "errors": []
            }
    
    def _get_extension(self, language: str) -> str:
        """Get file extension for language"""
        extensions = {
            'python': 'py',
            'javascript': 'js',
            'c': 'c',
            'cpp': 'cpp',
            'c++': 'cpp',
            'java': 'java',
            'go': 'go',
            'rust': 'rs'
        }
        return extensions.get(language, 'txt')
    
    def _lint_python(self, code: str, filename: str) -> List[Dict[str, Any]]:
        """Lint Python code using flake8 with fallback to syntax check"""
        errors = []
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Try flake8 first (lighter and faster than pylint)
            try:
                result = subprocess.run(
                    ['flake8', '--format=json', temp_path],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                
                if result.stdout:
                    data = json.loads(result.stdout)
                    for file_errors in data.values():
                        for error in file_errors:
                            errors.append({
                                'line': error.get('line_number', 1),
                                'column': error.get('column_number', 1),
                                'message': error.get('text', 'Unknown error'),
                                'severity': 'error' if error.get('code', '').startswith('E') else 'warning',
                                'code': error.get('code', ''),
                                'source': 'flake8'
                            })
            
            except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
                # Fallback: Try basic Python syntax check
                try:
                    compile(code, filename, 'exec')
                except SyntaxError as e:
                    errors.append({
                        'line': e.lineno or 1,
                        'column': e.offset or 1,
                        'message': str(e.msg),
                        'severity': 'error',
                        'code': 'E999',
                        'source': 'python'
                    })
        
        finally:
            # Cleanup temporary file
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors
    
    def _lint_javascript(self, code: str, filename: str) -> List[Dict[str, Any]]:
        """Lint JavaScript code using ESLint"""
        errors = []
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Try eslint
            try:
                result = subprocess.run(
                    ['eslint', '--format=json', temp_path],
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                
                if result.stdout:
                    data = json.loads(result.stdout)
                    if data and len(data) > 0:
                        for msg in data[0].get('messages', []):
                            errors.append({
                                'line': msg.get('line', 1),
                                'column': msg.get('column', 1),
                                'message': msg.get('message', 'Unknown error'),
                                'severity': 'error' if msg.get('severity', 1) == 2 else 'warning',
                                'code': msg.get('ruleId', ''),
                                'source': 'eslint'
                            })
            
            except (subprocess.TimeoutExpired, FileNotFoundError, json.JSONDecodeError):
                # ESLint not available or failed
                pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors


