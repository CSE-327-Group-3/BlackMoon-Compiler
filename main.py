from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import uvicorn
import os
import logging
from pathlib import Path
from contextlib import asynccontextmanager
from typing import Dict
import signal
import asyncio
from terminal_handler import TerminalHandler
from auth import (authenticate_user, create_access_token, verify_token, create_user, 
                  get_user_api_key, update_user_api_key, get_user_profile, 
                  update_user_profile, create_share_link, get_shared_file_info, delete_share_link)
from file_manager import FileManager
from ai_explainer import AIExplainer
from linter import CodeLinter
from formatter import CodeFormatter
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

active_connections: Dict[int, TerminalHandler] = {}
security = HTTPBearer()

# Initialize services
file_manager = FileManager()
code_linter = CodeLinter()
code_formatter = CodeFormatter()

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

class FileOperationRequest(BaseModel):
    project_name: str
    file_path: str
    new_path: str = ""

class FolderCreateRequest(BaseModel):
    project_name: str
    folder_path: str

class AIExplainRequest(BaseModel):
    code: str
    language: str
    explanation_type: str = "comprehensive"

class APIKeyUpdateRequest(BaseModel):
    api_key: str

class LintRequest(BaseModel):
    code: str
    language: str
    filename: str = None

class FormatRequest(BaseModel):
    code: str
    language: str

class ProfileUpdateRequest(BaseModel):
    profile_picture: str = None
    bio: str = None

class ShareLinkRequest(BaseModel):
    project_name: str
    file_path: str

class DeleteShareRequest(BaseModel):
    share_id: str

class AIChatRequest(BaseModel):
    message: str
    context_current_file: bool = False
    context_project: bool = False
    context_terminal: bool = False
    current_file_content: str = ""
    current_file_path: str = ""
    project_name: str = ""
    terminal_output: str = ""

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("🚀 BlackMoon Compiler starting up...")
    yield
    logger.info("🔄 Shutting down...")
    for handler in active_connections.values():
        await handler.cleanup()
    active_connections.clear()

app = FastAPI(title="BlackMoon Compiler", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- THIS IS THE CORRECT STATIC FILE MOUNT ---
STATIC_DIR = Config.STATIC_DIR
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")

@app.get("/")
async def serve_login():
    """Serve the login page"""
    login_path = STATIC_DIR / "login.html"
    if not login_path.exists():
        raise HTTPException(status_code=404, detail="login.html not found in static directory")
    return FileResponse(str(login_path))

@app.get("/app")
async def serve_index():
    """Serve the main application page"""
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        # Fallback to legacy enhanced version for compatibility
        legacy_path = STATIC_DIR / "enhanced_index.html"
        if legacy_path.exists():
            index_path = legacy_path
        else:
            raise HTTPException(status_code=404, detail="index.html not found in static directory")
    return FileResponse(str(index_path))

# Serve static assets with friendly fallbacks
@app.get("/styles.css")
@app.get("/enhanced_styles.css")
async def serve_styles():
    """Serve application styles"""
    css_path = STATIC_DIR / "styles.css"
    if not css_path.exists():
        legacy_path = STATIC_DIR / "enhanced_styles.css"
        if legacy_path.exists():
            css_path = legacy_path
        else:
            raise HTTPException(status_code=404, detail="styles.css not found")
    return FileResponse(str(css_path))

@app.get("/script.js")
@app.get("/enhanced_script.js")
async def serve_script():
    """Serve main application script"""
    js_path = STATIC_DIR / "script.js"
    if not js_path.exists():
        legacy_path = STATIC_DIR / "enhanced_script.js"
        if legacy_path.exists():
            js_path = legacy_path
        else:
            raise HTTPException(status_code=404, detail="script.js not found")
    return FileResponse(str(js_path))

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
        # Re-raise HTTP exceptions (like 401 for invalid credentials)
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

# File Management Endpoints
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

@app.put("/api/files/rename")
async def rename_file(request: FileOperationRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Rename a file in a project"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = file_manager.rename_file(username, request.project_name, request.file_path, request.new_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

# AI Explainer Endpoints
@app.post("/api/ai/explain")
async def explain_code(request: AIExplainRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Generate AI explanation of code"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    user_api_key = get_user_api_key(username)
    
    # Create AIExplainer instance with user's API key
    ai_explainer = AIExplainer(api_key=user_api_key)
    result = ai_explainer.explain_code(request.code, request.language, request.explanation_type)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.post("/api/ai/update-key")
async def update_ai_key(request: APIKeyUpdateRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Update user's Gemini API key"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = update_user_api_key(username, request.api_key)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/api/ai/status")
async def get_ai_status(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get AI service status for current user"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    user_api_key = get_user_api_key(username)
    
    # Create AIExplainer instance with user's API key to check status
    ai_explainer = AIExplainer(api_key=user_api_key)
    
    return {
        "ai_mode": "gemini" if ai_explainer.gemini_model else "fallback",
        "api_key_configured": bool(user_api_key),
        "gemini_available": ai_explainer.gemini_model is not None
    }

@app.post("/api/ai/chat")
async def ai_chat(request: AIChatRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """AI chatbot with context awareness"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    user_api_key = get_user_api_key(username)
    
    # Build context for AI
    context_parts = []
    
    if request.context_current_file and request.current_file_content:
        context_parts.append(f"Current file ({request.current_file_path}):\n```\n{request.current_file_content}\n```")
    
    if request.context_project and request.project_name:
        # Get all files in project
        files_result = file_manager.list_files(username, request.project_name)
        if files_result["success"]:
            project_files = []
            for item in files_result["files"]:
                if not item.get("is_dir"):
                    file_result = file_manager.read_file(username, request.project_name, item["path"])
                    if file_result["success"]:
                        project_files.append(f"File: {item['path']}\n```\n{file_result['content'][:1000]}...\n```")
            if project_files:
                context_parts.append("Project files:\n" + "\n\n".join(project_files[:5]))  # Limit to 5 files
    
    if request.context_terminal and request.terminal_output:
        context_parts.append(f"Terminal output:\n```\n{request.terminal_output[-2000:]}\n```")  # Last 2000 chars
    
    # Create prompt with context
    full_prompt = ""
    if context_parts:
        full_prompt = "Context:\n" + "\n\n".join(context_parts) + "\n\n"
    full_prompt += f"User question: {request.message}\n\nPlease provide a helpful, concise answer:"
    
    # Use AIExplainer to get response
    ai_explainer = AIExplainer(api_key=user_api_key)
    
    try:
        if ai_explainer.gemini_model:
            response = ai_explainer.gemini_model.generate_content(full_prompt)
            return {"response": response.text}
        else:
            return {"response": "AI chatbot requires a configured Gemini API key. Please set your API key in Settings."}
    except Exception as e:
        logger.error(f"AI chat error: {e}")
        return {"response": f"Sorry, I encountered an error: {str(e)}"}

# Code Linting Endpoint
@app.post("/api/lint")
async def lint_code(request: LintRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Lint code and return errors/warnings"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    result = code_linter.lint_code(request.code, request.language, request.filename)
    return result

# Code Formatting Endpoint
@app.post("/api/format")
async def format_code(request: FormatRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Format code using language-specific formatter"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    result = code_formatter.format_code(request.code, request.language)
    return result

# User Profile Endpoints
@app.get("/api/profile")
async def get_profile(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Get current user's profile"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    profile = get_user_profile(username)
    
    if not profile:
        raise HTTPException(status_code=404, detail="User not found")
    
    return profile

@app.post("/api/profile/update")
async def update_profile(request: ProfileUpdateRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Update user's profile"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = update_user_profile(username, request.profile_picture, request.bio)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

# File Sharing Endpoints
@app.post("/api/share/create")
async def create_share(request: ShareLinkRequest, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Create a shareable link for a file"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = create_share_link(username, request.project_name, request.file_path)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result.get("message", "Failed to create share link"))
    
    return result

@app.delete("/api/share/{share_id}")
async def delete_share(share_id: str, credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Delete a shareable link"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    result = delete_share_link(username, share_id)
    
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return result

@app.get("/api/share/list")
async def list_shares(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """List all shared files for current user"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    username = payload.get("sub")
    from auth import users_db
    
    user = users_db.get(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    shared_files = user.get("shared_files", {})
    return {"shares": shared_files}

@app.get("/share/{share_id}")
async def view_shared_file(share_id: str):
    """Public endpoint to view a shared file (no authentication required)"""
    share_info = get_shared_file_info(share_id)
    
    if not share_info:
        raise HTTPException(status_code=404, detail="Shared file not found")
    
    # Get the file content
    username = share_info["username"]
    project = share_info["project"]
    file_path = share_info["file_path"]
    
    file_result = file_manager.read_file(username, project, file_path)
    
    if not file_result["success"]:
        raise HTTPException(status_code=404, detail="File not found or no longer accessible")
    
    return FileResponse("static/share_view.html")

@app.get("/api/share/{share_id}/data")
async def get_shared_file_data(share_id: str):
    """Get data for a shared file (public, no auth)"""
    share_info = get_shared_file_info(share_id)
    
    if not share_info:
        raise HTTPException(status_code=404, detail="Shared file not found")
    
    # Get the file content
    username = share_info["username"]
    project = share_info["project"]
    file_path = share_info["file_path"]
    
    file_result = file_manager.read_file(username, project, file_path)
    
    if not file_result["success"]:
        raise HTTPException(status_code=404, detail="File not found or no longer accessible")
    
    return {
        "username": username,
        "profile_picture": share_info["profile_picture"],
        "bio": share_info["bio"],
        "file_path": file_path,
        "code": file_result["content"],
        "created_at": share_info["created_at"]
    }

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "active_connections": len(active_connections),
        "static_files": len(list(STATIC_DIR.iterdir())) if STATIC_DIR.exists() else 0
    }

@app.websocket("/api/terminal")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for terminal communication"""
    connection_id = id(websocket)

    try:
        await websocket.accept()
        logger.info(f"📱 New WebSocket connection: {connection_id}")
        # Proactive handshake message so frontend can verify connectivity
        try:
            await websocket.send_text("BLACKMOON_WS_READY\n")
        except Exception as e:
            logger.error(f"Failed to send WS ready message: {e}")

        handler = TerminalHandler(websocket)
        active_connections[connection_id] = handler

        while True:
            try:
                data = await websocket.receive_text()
                logger.info(f"📩 Received from {connection_id}: {data[:100]}")
                await handler.handle_message(data)

            except WebSocketDisconnect:
                logger.info(f"📤 WebSocket disconnected: {connection_id}")
                break
            except Exception as e:
                logger.error(f"❌ WebSocket error for {connection_id}: {e}")
                await websocket.send_text(f"❌ Error: {str(e)}\n")

    except Exception as e:
        logger.error(f"❌ Connection error {connection_id}: {e}")

    finally:
        if connection_id in active_connections:
            handler = active_connections.pop(connection_id)
            await handler.cleanup()
            logger.info(f"🧹 Cleaned up connection: {connection_id}")

def signal_handler(signum, frame):
    """Handle shutdown signals"""
    logger.info("🛑 Received shutdown signal")
    exit(0)

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

if __name__ == "__main__":
    port = Config.PORT
    host = Config.HOST
    logger.info(f"🌐 Starting server on http://{host}:{port}")
    uvicorn.run(
        "main:app", 
        host=host, 
        port=port,
        reload=False, # <-- RELOADER IS NOW OFF
        log_level="info"
    )

