from fastapi import FastAPI, HTTPException, Depends
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel
import uvicorn
import logging
from pathlib import Path

# Import authentication module
from auth import authenticate_user, create_access_token, verify_token, create_user
from config import Config

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Security
security = HTTPBearer()

# Initialize app
app = FastAPI(title="BlackMoon Compiler", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Static file serving
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

# Serve HTML pages
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

# Authentication endpoints with proper logic
@app.post("/api/login")
async def login(request: LoginRequest):
    """Login endpoint with JWT token generation"""
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
    """Signup endpoint with user creation"""
    result = create_user(request.username, request.email, request.password)
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["message"])
    
    return {
        "message": result["message"],
        "username": request.username
    }

@app.get("/api/verify")
async def verify_user_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    """Verify JWT token"""
    payload = verify_token(credentials.credentials)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    
    return {"valid": True, "username": payload.get("sub")}

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


