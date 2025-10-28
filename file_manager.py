import os
import json
import shutil
from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime
import uuid

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
    
    def delete_project(self, username: str, project_name: str) -> Dict[str, Any]:
        """Delete an entire project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        try:
            shutil.rmtree(project_dir)
            return {"success": True, "message": "Project deleted successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error deleting project: {str(e)}"}
    
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
    
    def create_folder(self, username: str, project_name: str, folder_path: str) -> Dict[str, Any]:
        """Create a new folder in a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        full_path = project_dir / folder_path
        
        try:
            full_path.mkdir(parents=True, exist_ok=False)
            self._update_project_meta(project_dir)
            return {
                "success": True,
                "message": "Folder created successfully",
                "folder_path": str(full_path)
            }
        
        except FileExistsError:
            return {"success": False, "message": "Folder already exists"}
        
        except Exception as e:
            return {"success": False, "message": f"Error creating folder: {str(e)}"}
    
    def delete_folder(self, username: str, project_name: str, folder_path: str) -> Dict[str, Any]:
        """Delete a folder and all its contents"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        
        if not project_dir.exists():
            return {"success": False, "message": "Project not found"}
        
        full_path = project_dir / folder_path
        
        if not full_path.exists():
            return {"success": False, "message": "Folder not found"}
        
        if not full_path.is_dir():
            return {"success": False, "message": "Path is not a folder"}
        
        try:
            shutil.rmtree(full_path)
            self._update_project_meta(project_dir)
            return {"success": True, "message": "Folder deleted successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error deleting folder: {str(e)}"}
    
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
    
    def rename_file(self, username: str, project_name: str, old_path: str, new_path: str) -> Dict[str, Any]:
        """Rename a file in a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        old_full_path = project_dir / old_path
        new_full_path = project_dir / new_path
        
        if not old_full_path.exists():
            return {"success": False, "message": "File not found"}
        
        if new_full_path.exists():
            return {"success": False, "message": "Target file already exists"}
        
        try:
            new_full_path.parent.mkdir(parents=True, exist_ok=True)
            old_full_path.rename(new_full_path)
            self._update_project_meta(project_dir)
            return {"success": True, "message": "File renamed successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error renaming file: {str(e)}"}
    
    def copy_file(self, username: str, project_name: str, source_path: str, dest_path: str) -> Dict[str, Any]:
        """Copy a file within a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        source_full_path = project_dir / source_path
        dest_full_path = project_dir / dest_path
        
        if not source_full_path.exists():
            return {"success": False, "message": "Source file not found"}
        
        if dest_full_path.exists():
            return {"success": False, "message": "Destination file already exists"}
        
        try:
            dest_full_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_full_path, dest_full_path)
            self._update_project_meta(project_dir)
            return {"success": True, "message": "File copied successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error copying file: {str(e)}"}
    
    def move_file(self, username: str, project_name: str, source_path: str, dest_path: str) -> Dict[str, Any]:
        """Move a file within a project"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        source_full_path = project_dir / source_path
        dest_full_path = project_dir / dest_path
        
        if not source_full_path.exists():
            return {"success": False, "message": "Source file not found"}
        
        if dest_full_path.exists():
            return {"success": False, "message": "Destination file already exists"}
        
        try:
            dest_full_path.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(str(source_full_path), str(dest_full_path))
            self._update_project_meta(project_dir)
            return {"success": True, "message": "File moved successfully"}
        
        except Exception as e:
            return {"success": False, "message": f"Error moving file: {str(e)}"}
    
    def get_file_info(self, username: str, project_name: str, file_path: str) -> Dict[str, Any]:
        """Get detailed information about a file"""
        user_dir = self.create_user_project_dir(username)
        project_dir = user_dir / project_name
        full_path = project_dir / file_path
        
        if not full_path.exists():
            return {"success": False, "message": "File not found"}
        
        try:
            stats = full_path.stat()
            return {
                "success": True,
                "file_info": {
                    "name": full_path.name,
                    "path": str(file_path),
                    "size": stats.st_size,
                    "created": datetime.fromtimestamp(stats.st_ctime).isoformat(),
                    "modified": datetime.fromtimestamp(stats.st_mtime).isoformat(),
                    "is_file": full_path.is_file(),
                    "extension": full_path.suffix
                }
            }
        
        except Exception as e:
            return {"success": False, "message": f"Error getting file info: {str(e)}"}
    
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

