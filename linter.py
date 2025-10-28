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
        """Lint Python code using basic syntax checking"""
        errors = []
        
        # Basic Python syntax check using compile()
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
        
        return errors


