import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class Config:
    """Centralized configuration for BlackMoon Compiler"""
    
    # Server settings
    HOST = os.getenv("HOST", "0.0.0.0")
    PORT = int(os.getenv("PORT", "8081"))
    RELOAD = os.getenv("RELOAD", "True").lower() == "true"
    
    # Security settings
    SECRET_KEY = os.getenv("SECRET_KEY", "change-this-secret-key-in-production")
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))
    
    # Execution limits
    MAX_EXECUTION_TIME = int(os.getenv("MAX_EXECUTION_TIME", "30"))
    MAX_OUTPUT_SIZE = int(os.getenv("MAX_OUTPUT_SIZE", "1048576"))  # 1MB
    MAX_CODE_SIZE = int(os.getenv("MAX_CODE_SIZE", "51200"))  # 50KB
    MAX_INPUT_SIZE = int(os.getenv("MAX_INPUT_SIZE", "1000"))
    
    # Docker settings
    DOCKER_MEMORY_LIMIT = os.getenv("DOCKER_MEMORY_LIMIT", "128m")
    DOCKER_CPU_LIMIT = os.getenv("DOCKER_CPU_LIMIT", "0.5")
    DOCKER_TIMEOUT = int(os.getenv("DOCKER_TIMEOUT", "25"))
    
    # File paths
    BASE_DIR = Path(__file__).resolve().parent
    STATIC_DIR = BASE_DIR / "static"
    USER_DATA_DIR = BASE_DIR / "user_data"
    
    # AI Configuration
    GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
    
    # Supported languages
    SUPPORTED_LANGUAGES = ["python", "c", "cpp", "c++", "java", "javascript", "go", "rust"]


