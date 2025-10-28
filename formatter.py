# formatter.py - Complete with Java, Go, and Rust support
import subprocess
import tempfile
import os
from pathlib import Path
from typing import Dict, Any

class CodeFormatter:
    """Multi-language code formatting"""
    
    def __init__(self):
        self.formatters = {
            'python': self._format_python,
            'javascript': self._format_javascript,
            'c': self._format_c,
            'cpp': self._format_cpp,
            'c++': self._format_cpp,
            'java': self._format_java,
            'go': self._format_go,
            'rust': self._format_rust,
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
        """Format Python code using Black with autopep8 fallback"""
        try:
            # Try Black first (most popular Python formatter)
            result = subprocess.run(
                ['black', '--quiet', '--line-length', '88', '-'],
                input=code,
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
            
            # Fallback to autopep8
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
            pass
        
        return code
    
    def _format_javascript(self, code: str) -> str:
        """Format JavaScript code using prettier"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.js', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Try prettier
            result = subprocess.run(
                ['prettier', '--parser', 'babel', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return code
    
    def _format_c(self, code: str) -> str:
        """Format C code using clang-format"""
        try:
            result = subprocess.run(
                ['clang-format', '--style=LLVM'],
                input=code,
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        return code
    
    def _format_cpp(self, code: str) -> str:
        """Format C++ code using clang-format"""
        try:
            result = subprocess.run(
                ['clang-format', '--style=LLVM', '--assume-filename=file.cpp'],
                input=code,
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        return code
    
    def _format_java(self, code: str) -> str:
        """Format Java code using google-java-format"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.java', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # Try google-java-format
            result = subprocess.run(
                ['google-java-format', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return code
    
    def _format_go(self, code: str) -> str:
        """Format Go code using gofmt"""
        try:
            result = subprocess.run(
                ['gofmt'],
                input=code,
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0 and result.stdout:
                return result.stdout
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        return code
    
    def _format_rust(self, code: str) -> str:
        """Format Rust code using rustfmt"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.rs', delete=False) as f:
            f.write(code)
            temp_path = f.name
        
        try:
            # rustfmt modifies file in place
            result = subprocess.run(
                ['rustfmt', temp_path],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            if result.returncode == 0:
                with open(temp_path, 'r') as f:
                    return f.read()
        
        except (subprocess.TimeoutExpired, FileNotFoundError):
            pass
        
        finally:
            try:
                os.unlink(temp_path)
            except:
                pass
        
        return code
    
    def _format_json(self, code: str) -> str:
        """Format JSON"""
        try:
            import json
            parsed = json.loads(code)
            return json.dumps(parsed, indent=2, ensure_ascii=False)
        except:
            return code

