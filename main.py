from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import uvicorn
import logging
from pathlib import Path
from typing import Dict

from auth import authenticate_user, create_access_token, verify_token, create_user
from file_manager import FileManager
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

security = HTTPBearer()

# Initialize services
file_manager = FileManager()

# Initialize app
app = FastAPI(title="BlackMoon Compiler", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static files
STATIC_DIR = Config.STATIC_DIR
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

# Pydantic models
class LoginRequest(BaseModel):
    username: str
    password: str
    remember: bool = False

class SignupRequest(BaseModel):
    username: str
    email: str
    password: str

class ProjectRequest(BaseModel):
    project_name: str

class FileRequest(BaseModel):
    project_name: str
    file_path: str
    content: str = ""

class FolderCreateRequest(BaseModel):
    project_name: str
    folder_path: str

# Serve pages
@app.get("/")
async def serve_login():
    """Serve the login page"""
    login_path = STATIC_DIR / "login.html"
    if not login_path.exists():
        raise HTTPException(status_code=404, detail="login.html not found")
    return FileResponse(str(login_path))

@app.get("/app")
async def serve_index():
    """Serve the main application page"""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="index.html not found")
    return FileResponse(str(index_path))

@app.get("/favicon.ico")
async def serve_favicon():
    return Response(status_code=204)

# Authentication endpoints
@app.post("/api/login")
async def login(request: LoginRequest):
    """Login endpoint"""
    try:
        user = authenticate_user(request.username, request.password)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid username or password")
        
        token = create_access_token(
            data={"sub": user["username"]},
            remember=request.remember
        )
        
        return {
            "token": token,
            "message": "Login successful",
            "username": user["username"]
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")

@app.post("/api/signup")
async def signup(request: SignupRequest):
    """Signup endpoint"""
    result = create_user(request.username, request.email, request.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return {
        "message": result["message"],
        "username": request.username
    }

@app.get("/api/verify")
async def verify_user_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify token endpoint"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return {"valid": True, "username": payload.get("sub")}

# Project Management Endpoints
@app.post("/api/projects/create")
async def create_project(request: ProjectRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Create a new project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.create_project(username, request.project_name)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/api/projects")
async def get_projects(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get all projects for the user"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    projects = file_manager.get_user_projects(username)
    
    return {"projects": projects}

@app.delete("/api/projects/{project_name}")
async def delete_project(project_name: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.delete_project(username, project_name)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

# File Management Endpoints
@app.post("/api/files/create")
async def create_file(request: FileRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Create a new file in a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.create_file(username, request.project_name, request.file_path, request.content)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/folders/create")
async def create_folder(request: FolderCreateRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Create a new folder in a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.create_folder(username, request.project_name, request.folder_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/api/files/{project_name}")
async def list_files(project_name: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """List all files in a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.list_files(username, project_name)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/api/files/{project_name}/{file_path:path}")
async def read_file(project_name: str, file_path: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Read a file from a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.read_file(username, project_name, file_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.put("/api/files/save")
async def save_file(request: FileRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Save content to a file"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.save_file(username, request.project_name, request.file_path, request.content)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.delete("/api/files/{project_name}/{file_path:path}")
async def delete_file(project_name: str, file_path: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a file from a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.delete_file(username, project_name, file_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.delete("/api/folders/{project_name}/{folder_path:path}")
async def delete_folder(project_name: str, folder_path: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a folder from a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.delete_folder(username, project_name, folder_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "static_files": len(list(STATIC_DIR.iterdir())) if STATIC_DIR.exists() else 0
    }

if __name__ == "__main__":
    port = Config.PORT
    host = Config.HOST
    logger.info(f"🌐 Starting server on http://{host}:{port}")
    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=True,
        log_level="info"
    )


