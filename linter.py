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
            'c': self._lint_c,
            'cpp': self._lint_cpp,
            'c++': self._lint_cpp,
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
        """Lint Python code using flake8 with fallback"""
        errors = []
        
        # Create temporary file
        with tempfile.NamedTemporaryFile(mode='w', suffix='.py', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Try flake8 first
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
                # Fallback to syntax check
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
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors
    
    def _lint_javascript(self, code: str, filename: str) -> List[Dict[str, Any]]:
        """Lint JavaScript code using ESLint"""
        errors = []
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
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
                pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors
    
    def _lint_c(self, code: str, filename: str) -> List[Dict[str, Any]]:
        """Lint C code using gcc syntax check"""
        errors = []
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.c', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Use gcc for syntax checking with warnings
            result = subprocess.run(
                ['gcc', '-fsyntax-only', '-Wall', '-Wextra', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.stderr:
                # Parse gcc output format: file:line:col: severity: message
                for line in result.stderr.split('\n'):
                    if ':' in line and ('error' in line.lower() or 'warning' in line.lower()):
                        parts = line.split(':')
                        if len(parts) >= 4:
                            try:
                                line_num = int(parts[1])
                                col_num = int(parts[2]) if parts[2].strip().isdigit() else 1
                                message = ':'.join(parts[3:]).strip()
                                severity = 'error' if 'error' in line.lower() else 'warning'
                                
                                errors.append({
                                    'line': line_num,
                                    'column': col_num,
                                    'message': message,
                                    'severity': severity,
                                    'code': '',
                                    'source': 'gcc'
                                })
                            except ValueError:
                                pass
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors
    
    def _lint_cpp(self, code: str, filename: str) -> List[Dict[str, Any]]:
        """Lint C++ code using g++ syntax check"""
        errors = []
        
        with tempfile.NamedTemporaryFile(mode='w', suffix='.cpp', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Use g++ for syntax checking with C++17 standard
            result = subprocess.run(
                ['g++', '-fsyntax-only', '-Wall', '-Wextra', '-std=c++17', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.stderr:
                # Parse g++ output
                for line in result.stderr.split('\n'):
                    if ':' in line and ('error' in line.lower() or 'warning' in line.lower()):
                        parts = line.split(':')
                        if len(parts) >= 4:
                            try:
                                line_num = int(parts[1])
                                col_num = int(parts[2]) if parts[2].strip().isdigit() else 1
                                message = ':'.join(parts[3:]).strip()
                                severity = 'error' if 'error' in line.lower() else 'warning'
                                
                                errors.append({
                                    'line': line_num,
                                    'column': col_num,
                                    'message': message,
                                    'severity': severity,
                                    'code': '',
                                    'source': 'g++'
                                })
                            except ValueError:
                                pass
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return errors


