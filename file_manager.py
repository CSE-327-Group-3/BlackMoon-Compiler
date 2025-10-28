import os
import json
from pathlib import Path
from typing import Dict, List, Any
from datetime import datetime

class FileManager:
    """Manage user projects and files"""
    
    def __init__(self, base_dir: str = "user_projects"):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(exist_ok=True)
    
    def create_user_project_dir(self, username: str) -> Path:
        """Create a project directory for a user"""
        user_dir = self.base_dir / username
        user_dir.mkdir(exist_ok=True)
        return user_dir
    
    def create_project(self, username: str, project_name: str) -> Dict[str, Any]:
        """Create a new project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if project_dir.exists():
            return {"success": False, "message": "Project already exists"}
        
        project_dir.mkdir(exist_ok=True)
        
        # Create project metadata
        project_meta = {
            "name": project_name,
            "created_at": datetime.utcnow().isoformat(),
            "last_modified": datetime.utcnow().isoformat(),
            "files": []
        }
        
        meta_file = project_dir / "project.json"
        with open(meta_file, 'w') as f:
            json.dump(project_meta, f, indent=2)
        
        return {
            "success": True,
            "message": "Project created successfully",
            "project_path": str(project_dir)
        }
    
    def get_user_projects(self, username: str) -> List[Dict[str, Any]]:
        """Get all projects for a user"""
        user_dir = self.create_user_project_dir(username)
        projects = []
        
        for project_dir in user_dir.iterdir():
            if project_dir.is_dir():
                meta_file = project_dir / "project.json"
                if meta_file.exists():
                    with open(meta_file, 'r') as f:
                        project_meta = json.load(f)
                        project_meta["path"] = str(project_dir)
                        projects.append(project_meta)
        
        return sorted(projects, key=lambda x: x["last_modified"], reverse=True)
    
    def create_file(self, username: str, project_name: str, file_path: str, content: str = "") -> Dict[str, Any]:
        """Create a new file in a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        full_path = project_dir / file_path
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(full_path, 'w', encoding='utf-8') as f:
            f.write(content)
        
        # Update project metadata
        self._update_project_meta(project_dir)
        
        return {
            "success": True,
            "message": "File created successfully",
            "file_path": str(full_path)
        }
    
    def read_file(self, username: str, project_name: str, file_path: str) -> Dict[str, Any]:
        """Read a file from a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        full_path = project_dir / file_path
        
        if not full_path.exists():
            return {"success": False, "message": "File not found"}
        
        try:
            with open(full_path, 'r', encoding='utf-8') as f:
                content = f.read()
            
            return {
                "success": True,
                "content": content,
                "file_path": str(full_path)
            }
        
        except Exception as e:
            return {"success": False, "message": f"Error reading file: {str(e)}"}
    
    def save_file(self, username: str, project_name: str, file_path: str, content: str) -> Dict[str, Any]:
        """Save content to a file in a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        full_path = project_dir / file_path
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        full_path.parent.mkdir(parents=True, exist_ok=True)
        
        try:
            with open(full_path, 'w', encoding='utf-8') as f:
                f.write(content)
            
            # Update project metadata
            self._update_project_meta(project_dir)
            
            return {"success": True, "message": "File saved successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error saving file: {str(e)}"}
    
    def delete_file(self, username: str, project_name: str, file_path: str) -> Dict[str, Any]:
        """Delete a file from a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        full_path = project_dir / file_path
        
        if not full_path.exists():
            return {"success": False, "message": "File not found"}
        
        try:
            full_path.unlink()
            self._update_project_meta(project_dir)
            return {"success": True, "message": "File deleted successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error deleting file: {str(e)}"}
    
    def list_files(self, username: str, project_name: str) -> Dict[str, Any]:
        """List all files and folders in a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        items = []
        
        for item_path in project_dir.rglob("*"):
            # Skip project metadata
            if item_path.name == "project.json":
                continue
            
            relative_path = item_path.relative_to(project_dir)
            item_info = {
                "name": item_path.name,
                "path": str(relative_path),
                "is_dir": item_path.is_dir(),
                "modified": datetime.fromtimestamp(item_path.stat().st_mtime).isoformat()
            }
            
            # Add size only for files
            if item_path.is_file():
                item_info["size"] = item_path.stat().st_size
            
            items.append(item_info)
        
        return {"success": True, "files": items}
    
    def _update_project_meta(self, project_dir: Path):
        """Update project metadata"""
        meta_file = project_dir / "project.json"
        
        if meta_file.exists():
            with open(meta_file, 'r') as f:
                project_meta = json.load(f)
        else:
            project_meta = {"files": []}
        
        project_meta["last_modified"] = datetime.utcnow().isoformat()
        
        with open(meta_file, 'w') as f:
            json.dump(project_meta, f, indent=2)


