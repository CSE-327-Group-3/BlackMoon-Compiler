import json
import re
import os
from typing import Dict, Any, List, Optional
from datetime import datetime
from config import Config

# Try to import google.generativeai
GEMINI_AVAILABLE = False
genai = None

try:
    import google.generativeai as genai
    GEMINI_AVAILABLE = True
    print("✅ google-generativeai library loaded successfully")
except ImportError as e:
    print(f"⚠️ Warning: google-generativeai not installed: {e}")
    print("   AI features will use fallback mode.")
except Exception as e:
    print(f"⚠️ Error loading google-generativeai: {e}")

class AIExplainer:
    def __init__(self, api_key: Optional[str] = None):
        self.api_key = api_key or Config.GEMINI_API_KEY
        self.gemini_model = None
        self.fallback_mode = False
        
        # Initialize Gemini if available
        if GEMINI_AVAILABLE and self.api_key:
            try:
                genai.configure(api_key=self.api_key)
                # Use gemini-2.5-flash (latest stable model)
                self.gemini_model = genai.GenerativeModel('gemini-2.5-flash')
                print("✅ Gemini AI initialized successfully with gemini-2.5-flash")
            except Exception as e:
                print(f"⚠️ Failed to initialize Gemini: {e}")
                self.fallback_mode = True
        else:
            self.fallback_mode = True
            if not self.api_key:
                print("⚠️ No Gemini API key provided. Using fallback mode.")
        
        # Fallback templates
        self.explanation_templates = {
            "python": {"basic": "Let me explain this Python code step by step:"},
            "javascript": {"basic": "Let me explain this JavaScript code step by step:"},
            "c": {"basic": "Let me explain this C code step by step:"},
            "cpp": {"basic": "Let me explain this C++ code step by step:"}
        }
    
    def update_api_key(self, api_key: str) -> Dict[str, Any]:
        """Update the Gemini API key"""
        if not GEMINI_AVAILABLE:
            return {"success": False, "message": "google-generativeai library not installed"}
        
        try:
            genai.configure(api_key=api_key)
            self.gemini_model = genai.GenerativeModel('gemini-2.5-flash')
            self.api_key = api_key
            self.fallback_mode = False
            return {"success": True, "message": "API key updated successfully"}
        except Exception as e:
            return {"success": False, "message": f"Failed to configure API key: {str(e)}"}
    
    def explain_code(self, code: str, language: str, explanation_type: str = "comprehensive") -> Dict[str, Any]:
        """Generate a comprehensive explanation of the code using Gemini AI or fallback"""
        try:
            if not code or not code.strip():
                return {"success": False, "message": "No code provided"}
            
            if not language:
                return {"success": False, "message": "Language not specified"}
            
            cleaned_code = self._clean_code(code)
            code_structure = self._analyze_code_structure(cleaned_code, language)
            
            if not self.fallback_mode and self.gemini_model:
                explanation = self._generate_gemini_explanation(cleaned_code, language, explanation_type, code_structure)
            else:
                explanation = self._generate_fallback_explanation(cleaned_code, language, explanation_type, code_structure)
            
            return {
                "success": True,
                "explanation": explanation,
                "code_structure": code_structure,
                "language": language,
                "ai_mode": "gemini" if not self.fallback_mode else "fallback",
                "timestamp": datetime.utcnow().isoformat()
            }
        except Exception as e:
            return {"success": False, "message": f"Error generating explanation: {str(e)}"}
    
    def _generate_gemini_explanation(self, code: str, language: str, explanation_type: str, structure: Dict[str, Any]) -> str:
        """Generate explanation using Gemini AI"""
        try:
            prompts = {
                "comprehensive": f"""You are the "Comprehensive" section of an AI code explainer bot.

Your task:
Given a code snippet, provide ONLY a detailed comprehensive explanation of what the entire code does, how it works as a whole, and what problem it solves.

Structure your output EXACTLY as follows:

---
### 🧩 Comprehensive Explanation

<Provide a thorough explanation of the overall logic and purpose of the code. Focus on clarity and completeness.>

---

### 📚 Learn More

**IMPORTANT: Provide 3-6 ACTUAL clickable resources with real URLs:**

Example format:
- **Python Official Documentation** - Learn about built-in functions: https://docs.python.org/3/library/functions.html
- **W3Schools Python Tutorial** - Basic syntax and examples: https://www.w3schools.com/python/
- **Real Python** - In-depth Python tutorials: https://realpython.com/
- **MDN Web Docs** (for JavaScript): https://developer.mozilla.org/en-US/docs/Web/JavaScript
- **GeeksforGeeks** - Programming concepts explained: https://www.geeksforgeeks.org/

Provide REAL, WORKING URLs to official documentation, tutorials, or reputable learning sites relevant to the {language} code and concepts used.
---

❗Do NOT include line-by-line explanations or specific concept breakdowns. Only describe the overall behavior and provide resources WITH ACTUAL URLs.

Code to analyze:
```{language}
{code}
```""",

                "line_by_line": f"""You are the "Line by Line" section of an AI code explainer bot.

Your task:
Given a code snippet, explain what each line (or logical block if needed) does — clearly, briefly, and ONLY in terms of direct function.

Structure your output EXACTLY as follows:

---
### 📜 Line by Line Explanation

1. `<line of code>` — <short explanation of what this line does.>
2. `<line of code>` — <short explanation.>
3. ...
---

❗Do NOT include any conceptual theory, purpose of the code, or additional notes. Only explain each line's immediate action.

Code to analyze:
```{language}
{code}
```""",

                "concepts": f"""You are the "Concepts" section of an AI code explainer bot.

Your task:
Given a code snippet, identify all key programming concepts, functions, classes, or libraries used, and provide concise explanations for each one.

Structure your output EXACTLY as follows:

---
### 🧠 Concepts Explained

- **Concept 1:** <clear, concise explanation of the concept.>
- **Concept 2:** <explanation.>
- **Concept 3:** <explanation.>
...

---

❗Do NOT describe what the entire code does or what each line does. Only explain the concepts, functions, or ideas involved.

Code to analyze:
```{language}
{code}
```"""
            }
            
            prompt = prompts.get(explanation_type, prompts["comprehensive"])
            
            # Generate response using Gemini
            response = self.gemini_model.generate_content(prompt)
            
            if response and response.text:
                return response.text
            else:
                return "⚠️ Could not generate explanation from Gemini API"
                
        except Exception as e:
            print(f"Gemini API error: {e}")
            # Fallback to template-based explanation
            return self._generate_fallback_explanation(code, language, explanation_type, structure)
    
    def _generate_fallback_explanation(self, code: str, language: str, explanation_type: str, structure: Dict[str, Any]) -> str:
        """Generate explanation using templates"""
        if explanation_type == "comprehensive":
            return self._generate_comprehensive_explanation(code, language, structure)
        elif explanation_type == "line_by_line":
            return self._generate_line_by_line_explanation(code, language)
        elif explanation_type == "concepts":
            return self._generate_concept_explanation(code, language, structure)
        else:
            return self._generate_comprehensive_explanation(code, language, structure)
    
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
            
            if self._is_function_definition(line_stripped, language):
                structure["functions"].append({
                    "line": i,
                    "name": self._extract_function_name(line_stripped, language),
                    "signature": line_stripped
                })
            
            if self._is_class_definition(line_stripped, language):
                structure["classes"].append({
                    "line": i,
                    "name": self._extract_class_name(line_stripped, language),
                    "signature": line_stripped
                })
            
            if self._is_import_statement(line_stripped, language):
                structure["imports"].append({"line": i, "statement": line_stripped})
            
            if self._is_loop_statement(line_stripped, language):
                structure["loops"].append({"line": i, "type": self._get_loop_type(line_stripped, language)})
            
            if self._is_conditional_statement(line_stripped, language):
                structure["conditionals"].append({"line": i, "type": self._get_conditional_type(line_stripped, language)})
        
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
    
    def _get_loop_type(self, line: str, language: str) -> str:
        if 'for' in line:
            return "for"
        elif 'while' in line:
            return "while"
        return "unknown"
    
    def _get_conditional_type(self, line: str, language: str) -> str:
        if re.match(r'^\s*if\s+', line):
            return "if"
        elif re.match(r'^\s*elif\s+', line):
            return "elif"
        elif re.match(r'^\s*else', line):
            return "else"
        return "unknown"
    
    def _generate_comprehensive_explanation(self, code: str, language: str, structure: Dict[str, Any]) -> str:
        parts = []
        parts.append("# 🤖 Code Explanation (Template Mode)\n")
        parts.append("⚠️ **Note:** Using template-based explanation. Configure Gemini API for AI-powered insights.\n")
        parts.append("## 📊 Overview\n")
        parts.append(f"**Language:** {language.upper()}\n")
        parts.append(f"**Lines:** {structure['lines']}\n")
        parts.append(f"**Functions:** {len(structure['functions'])}\n")
        parts.append(f"**Classes:** {len(structure['classes'])}\n")
        parts.append(f"**Imports:** {len(structure['imports'])}\n\n")
        
        if structure['functions']:
            parts.append(f"### 🔧 Functions ({len(structure['functions'])})\n")
            for func in structure['functions']:
                parts.append(f"- **`{func['name']}()`** at line {func['line']}\n")
        
        if structure['classes']:
            parts.append(f"\n### 📦 Classes ({len(structure['classes'])})\n")
            for cls in structure['classes']:
                parts.append(f"- **`{cls['name']}`** at line {cls['line']}\n")
        
        parts.append(f"\n## 💻 Your Code\n```{language}\n{code}\n```\n")
        parts.append("\n## 🎯 Learning Points\n")
        parts.append("- Study the structure and flow of the code\n")
        parts.append("- Understand how different parts work together\n")
        parts.append("- Practice by modifying and running the code\n")
        
        return "\n".join(parts)
    
    def _generate_line_by_line_explanation(self, code: str, language: str) -> str:
        parts = ["# 📝 Line-by-Line Explanation\n"]
        parts.append("⚠️ Configure Gemini API for detailed line-by-line analysis.\n")
        
        for i, line in enumerate(code.split('\n'), 1):
            if line.strip():
                parts.append(f"\n**Line {i}:** `{line}`\n")
        
        return "\n".join(parts)
    
    def _generate_concept_explanation(self, code: str, language: str, structure: Dict[str, Any]) -> str:
        parts = ["# 🧠 Programming Concepts\n"]
        parts.append("⚠️ Configure Gemini API for detailed concept explanations.\n\n")
        
        if structure['functions']:
            parts.append(f"### Functions: {len(structure['functions'])} found\n")
        if structure['classes']:
            parts.append(f"### Classes: {len(structure['classes'])} found\n")
        if structure['loops']:
            parts.append(f"### Loops: {len(structure['loops'])} found\n")
        if structure['conditionals']:
            parts.append(f"### Conditionals: {len(structure['conditionals'])} found\n")
        
        return "\n".join(parts)


