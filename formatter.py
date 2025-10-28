import subprocess
import json
from typing import Dict, Any

class CodeFormatter:
    """Multi-language code formatting"""
    
    def __init__(self):
        self.formatters = {
            'python': self._format_python,
            'json': self._format_json,
        }
    
    def format_code(self, code: str, language: str) -> Dict[str, Any]:
        """Format code and return formatted version"""
        try:
            if language not in self.formatters:
                return {
                    "success": False,
                    "message": f"Formatting not supported for {language}",
                    "code": code
                }
            
            formatted_code = self.formatters[language](code)
            
            return {
                "success": True,
                "code": formatted_code,
                "language": language,
                "changed": formatted_code != code
            }
        
        except Exception as e:
            return {
                "success": False,
                "message": f"Formatting error: {str(e)}",
                "code": code
            }
    
    def _format_python(self, code: str) -> str:
        """Format Python code using autopep8"""
        try:
            # Try autopep8 for Python formatting
            result = subprocess.run(
                ['autopep8', '--aggressive', '--aggressive', '-'],
                input=code,
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            # Tool not available, return original code
            pass
        
        return code
    
    def _format_json(self, code: str) -> str:
        """Format JSON"""
        try:
            parsed = json.loads(code)
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        except:
            return code

