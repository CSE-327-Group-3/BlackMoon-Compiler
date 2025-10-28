import re
from typing import Dict, Any, List
from datetime import datetime

class AIExplainer:
    """AI-powered code explanation system"""
    
    def __init__(self, api_key: str = None):
        self.api_key = api_key
        self.fallback_mode = True  # Start with template mode
    
    def explain_code(self, code: str, language: str, explanation_type: str = "comprehensive") -> Dict[str, Any]:
        """Generate explanation of the code"""
        try:
            if not code or not code.strip():
                return {"success": False, "message": "No code provided"}
            
            if not language:
                return {"success": False, "message": "Language not specified"}
            
            # Clean and analyze code
            cleaned_code = self._clean_code(code)
            code_structure = self._analyze_code_structure(cleaned_code, language)
            
            # Generate template-based explanation
            explanation = self._generate_template_explanation(cleaned_code, language, explanation_type, code_structure)
            
            return {
                "success": True,
                "explanation": explanation,
                "code_structure": code_structure,
                "language": language,
                "ai_mode": "template",
                "timestamp": datetime.utcnow().isoformat()
            }
        
        except Exception as e:
            return {"success": False, "message": f"Error generating explanation: {str(e)}"}
    
    def _clean_code(self, code: str) -> str:
        """Clean and normalize the code"""
        lines = code.split('\n')
        cleaned_lines = [line.rstrip() for line in lines]
        return '\n'.join(cleaned_lines)
    
    def _analyze_code_structure(self, code: str, language: str) -> Dict[str, Any]:
        """Analyze the structure of the code"""
        structure = {
            "lines": len(code.split('\n')),
            "characters": len(code),
            "functions": [],
            "classes": [],
            "imports": [],
            "loops": [],
            "conditionals": []
        }
        
        lines = code.split('\n')
        for i, line in enumerate(lines, 1):
            line_stripped = line.strip()
            
            # Detect functions
            if self._is_function_definition(line_stripped, language):
                structure["functions"].append({
                    "line": i,
                    "name": self._extract_function_name(line_stripped, language)
                })
            
            # Detect classes
            if self._is_class_definition(line_stripped, language):
                structure["classes"].append({
                    "line": i,
                    "name": self._extract_class_name(line_stripped, language)
                })
            
            # Detect imports
            if self._is_import_statement(line_stripped, language):
                structure["imports"].append({"line": i, "statement": line_stripped})
            
            # Detect loops
            if self._is_loop_statement(line_stripped, language):
                structure["loops"].append({"line": i, "type": self._get_loop_type(line_stripped)})
            
            # Detect conditionals
            if self._is_conditional_statement(line_stripped, language):
                structure["conditionals"].append({"line": i, "type": self._get_conditional_type(line_stripped)})
        
        return structure
    
    def _is_function_definition(self, line: str, language: str) -> bool:
        if language == "python":
            return bool(re.match(r'^def\s+\w+\s*\(', line))
        elif language in ["c", "cpp", "c++"]:
            return bool(re.match(r'^\w+.*\s+\w+\s*\([^)]*\)\s*\{?$', line)) and not line.endswith(';')
        elif language == "javascript":
            return bool(re.match(r'^(function\s+\w+|const\s+\w+\s*=\s*\(|let\s+\w+\s*=\s*\()', line))
        return False
    
    def _is_class_definition(self, line: str, language: str) -> bool:
        return bool(re.match(r'^class\s+\w+', line))
    
    def _is_import_statement(self, line: str, language: str) -> bool:
        if language == "python":
            return bool(re.match(r'^(import|from)\s+', line))
        elif language in ["c", "cpp", "c++"]:
            return bool(re.match(r'^#include\s*[<"]', line))
        elif language == "javascript":
            return bool(re.match(r'^(import|require)\s+', line))
        return False
    
    def _is_loop_statement(self, line: str, language: str) -> bool:
        if language == "python":
            return bool(re.match(r'^(for|while)\s+', line))
        elif language in ["c", "cpp", "c++"]:
            return bool(re.match(r'^(for|while)\s*\(', line))
        elif language == "javascript":
            return bool(re.match(r'^(for|while|do)\s*', line))
        return False
    
    def _is_conditional_statement(self, line: str, language: str) -> bool:
        if language == "python":
            return bool(re.match(r'^(if|elif|else)[\s:]', line))
        elif language in ["c", "cpp", "c++"]:
            return bool(re.match(r'^if\s*\(', line))
        elif language == "javascript":
            return bool(re.match(r'^(if|else\s+if|else)\s*', line))
        return False
    
    def _extract_function_name(self, line: str, language: str) -> str:
        if language == "python":
            match = re.search(r'def\s+(\w+)', line)
        elif language in ["c", "cpp", "c++"]:
            match = re.search(r'(\w+)\s*\([^)]*\)', line)
        elif language == "javascript":
            match = re.search(r'(?:function\s+(\w+)|(\w+)\s*=)', line)
            return (match.group(1) or match.group(2)) if match else "unknown"
        else:
            return "unknown"
        return match.group(1) if match else "unknown"
    
    def _extract_class_name(self, line: str, language: str) -> str:
        match = re.search(r'class\s+(\w+)', line)
        return match.group(1) if match else "unknown"
    
    def _get_loop_type(self, line: str) -> str:
        if 'for' in line:
            return "for"
        elif 'while' in line:
            return "while"
        return "unknown"
    
    def _get_conditional_type(self, line: str) -> str:
        if re.match(r'^\s*if\s+', line):
            return "if"
        elif re.match(r'^\s*elif\s+', line):
            return "elif"
        elif re.match(r'^\s*else', line):
            return "else"
        return "unknown"
    
    def _generate_template_explanation(self, code: str, language: str, explanation_type: str, structure: Dict[str, Any]) -> str:
        """Generate template-based explanation"""
        parts = []
        
        parts.append("# 🤖 Code Explanation\n")
        parts.append("⚠️ **Note:** Using template-based explanation. Configure Gemini API for AI-powered insights.\n")
        
        parts.append("\n## 📊 Code Overview\n")
        parts.append(f"**Language:** {language.upper()}\n")
        parts.append(f"**Lines of Code:** {structure['lines']}\n")
        parts.append(f"**Functions:** {len(structure['functions'])}\n")
        parts.append(f"**Classes:** {len(structure['classes'])}\n")
        
        if structure['functions']:
            parts.append(f"\n### 🔧 Functions Detected\n")
            for func in structure['functions']:
                parts.append(f"- `{func['name']}()` at line {func['line']}\n")
        
        if structure['classes']:
            parts.append(f"\n### 📦 Classes Detected\n")
            for cls in structure['classes']:
                parts.append(f"- `{cls['name']}` at line {cls['line']}\n")
        
        parts.append(f"\n## 💻 Your Code\n``````\n")
        
        parts.append("\n## 🎯 Next Steps\n")
        parts.append("- Configure your Gemini API key for AI-powered explanations\n")
        parts.append("- Get detailed line-by-line analysis\n")
        parts.append("- Understand programming concepts used\n")
        
        return "\n".join(parts)


