from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn
import logging

# Basic logging setup
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(title="BlackMoon Compiler", version="1.0.0")

# Add CORS middleware for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for request validation
class LoginRequest(BaseModel):
    username: str
    password: str

class SignupRequest(BaseModel):
    username: str
    email: str
    password: str

# Basic health check endpoint
@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "version": "1.0.0"}

# Authentication endpoints - basic structure
@app.post("/api/login")
async def login(request: LoginRequest):
    """Login endpoint"""
    # TODO: Implement authentication logic
    logger.info(f"Login attempt for user: {request.username}")
    
    # Placeholder response
    if request.username == "admin" and request.password == "admin":
        return {
            "token": "sample_token_12345",
            "message": "Login successful",
            "username": request.username
        }
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")

@app.post("/api/signup")
async def signup(request: SignupRequest):
    """Signup endpoint"""
    # TODO: Implement user creation logic
    logger.info(f"Signup attempt for user: {request.username}")
    
    return {
        "message": "User created successfully",
        "username": request.username
    }

if __name__ == "__main__":
    logger.info("🚀 Starting BlackMoon Compiler server...")
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="info"
    )


