import os
from pathlib import Path

class Config:
    """Centralized configuration for BlackMoon Compiler"""
    
    # Server settings
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8000"))
    
    # Security settings
    SECRET_KEY = os.getenv("SECRET_KEY")
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 30
    
    # File paths
    BASE_DIR = Path(__file__).resolve().parent
    STATIC_DIR = BASE_DIR / "static"
    USER_DATA_DIR = BASE_DIR / "user_data"
    
    # Execution limits
    MAX_EXECUTION_TIME = 30  # seconds
    MAX_OUTPUT_SIZE = 1048576  # 1MB
    
    # Supported languages
    SUPPORTED_LANGUAGES = ["python", "javascript", "c", "cpp", "java"]


