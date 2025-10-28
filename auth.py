import json
import hashlib
import secrets
from pathlib import Path
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
import jwt

# JWT settings
SECRET_KEY = "blackmoon-compiler-secret-key-2024"
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

# User storage
USERS_FILE = Path("users.json")
users_db: Dict[str, Dict[str, Any]] = {}

def load_users():
    """Load users from JSON file"""
    global users_db
    if USERS_FILE.exists():
        try:
            with open(USERS_FILE, 'r', encoding='utf-8') as f:
                users_db = json.load(f)
            print(f"[AUTH] Loaded {len(users_db)} users")
        except Exception as e:
            print(f"[AUTH] Error loading users: {e}")
            users_db = {}
    else:
        print("[AUTH] No users file found, starting fresh")
        users_db = {}

def save_users():
    """Save users to JSON file"""
    try:
        with open(USERS_FILE, 'w', encoding='utf-8') as f:
            json.dump(users_db, f, indent=2, ensure_ascii=False)
        print(f"[AUTH] Saved {len(users_db)} users")
    except Exception as e:
        print(f"[AUTH] Error saving users: {e}")

def hash_password(password: str) -> str:
    """Hash a password using SHA-256 with salt"""
    salt = secrets.token_hex(16)
    password_hash = hashlib.sha256((password + salt).encode('utf-8')).hexdigest()
    return f"{salt}:{password_hash}"

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against its hash"""
    try:
        if ':' not in hashed_password:
            return False
        
        salt, password_hash = hashed_password.split(':', 1)
        computed_hash = hashlib.sha256((plain_password + salt).encode('utf-8')).hexdigest()
        return computed_hash == password_hash
    
    except Exception as e:
        print(f"[AUTH] Password verification error: {e}")
        return False

def create_user(username: str, email: str, password: str) -> Dict[str, Any]:
    """Create a new user"""
    print(f"[AUTH] Creating user: {username}")
    
    # Validation
    if username in users_db:
        return {"success": False, "message": "Username already exists"}
    
    if len(username) < 3:
        return {"success": False, "message": "Username must be at least 3 characters"}
    
    if len(password) < 6:
        return {"success": False, "message": "Password must be at least 6 characters"}
    
    if '@' not in email or '.' not in email:
        return {"success": False, "message": "Invalid email format"}
    
    try:
        # Create user with all fields
        users_db[username] = {
            "username": username,
            "email": email,
            "password_hash": hash_password(password),
            "created_at": datetime.utcnow().isoformat(),
            "gemini_api_key": "",  # Per-user Gemini API key
            "profile_picture": "",  # Profile picture URL/path
            "bio": "",  # User bio/description
            "shared_files": {}  # Shared files: {share_id: {project, file_path, created_at}}
        }
        
        save_users()
        print(f"[AUTH] Successfully created user: {username}")
        return {"success": True, "message": "User created successfully"}
    
    except Exception as e:
        print(f"[AUTH] Error creating user: {e}")
        return {"success": False, "message": "Error creating user"}

def authenticate_user(username: str, password: str) -> Optional[Dict[str, Any]]:
    """Authenticate a user"""
    print(f"[AUTH] Authenticating user: {username}")
    
    try:
        user = users_db.get(username)
        if not user:
            print(f"[AUTH] User not found: {username}")
            return None
        
        if not verify_password(password, user["password_hash"]):
            print(f"[AUTH] Invalid password for user: {username}")
            return None
        
        print(f"[AUTH] Authentication successful for: {username}")
        return {
            "username": user["username"],
            "email": user["email"]
        }
    
    except Exception as e:
        print(f"[AUTH] Authentication error: {e}")
        return None

def create_access_token(data: dict, remember: bool = False) -> str:
    """Create JWT token"""
    try:
        to_encode = data.copy()
        
        if remember:
            expire = datetime.utcnow() + timedelta(days=30)
        else:
            expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
        
        to_encode.update({"exp": expire})
        token = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
        
        print(f"[AUTH] Created token for: {data.get('sub', 'unknown')}")
        return token
    
    except Exception as e:
        print(f"[AUTH] Token creation error: {e}")
        return ""

def verify_token(token: str) -> Optional[dict]:
    """Verify JWT token"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    
    except jwt.ExpiredSignatureError:
        print("[AUTH] Token expired")
        return None
    
    except jwt.JWTError as e:
        print(f"[AUTH] Token verification error: {e}")
        return None

def get_user_api_key(username: str) -> Optional[str]:
    """Get user's Gemini API key"""
    user = users_db.get(username)
    if user:
        return user.get("gemini_api_key", "")
    return None

def update_user_api_key(username: str, api_key: str) -> Dict[str, Any]:
    """Update user's Gemini API key"""
    print(f"[AUTH] Updating API key for user: {username}")
    
    if username not in users_db:
        return {"success": False, "message": "User not found"}
    
    try:
        users_db[username]["gemini_api_key"] = api_key
        save_users()
        print(f"[AUTH] Successfully updated API key for: {username}")
        return {"success": True, "message": "API key updated successfully"}
    
    except Exception as e:
        print(f"[AUTH] Error updating API key: {e}")
        return {"success": False, "message": "Error updating API key"}

def get_user_profile(username: str) -> Optional[Dict[str, Any]]:
    """Get user profile information (public safe data)"""
    user = users_db.get(username)
    if user:
        return {
            "username": user.get("username"),
            "email": user.get("email"),
            "profile_picture": user.get("profile_picture", ""),
            "bio": user.get("bio", ""),
            "created_at": user.get("created_at")
        }
    return None

def update_user_profile(username: str, profile_picture: str = None, bio: str = None) -> Dict[str, Any]:
    """Update user's profile information"""
    print(f"[AUTH] Updating profile for user: {username}")
    
    if username not in users_db:
        return {"success": False, "message": "User not found"}
    
    try:
        if profile_picture is not None:
            users_db[username]["profile_picture"] = profile_picture
        
        if bio is not None:
            users_db[username]["bio"] = bio
        
        save_users()
        print(f"[AUTH] Successfully updated profile for: {username}")
        return {"success": True, "message": "Profile updated successfully"}
    
    except Exception as e:
        print(f"[AUTH] Error updating profile: {e}")
        return {"success": False, "message": "Error updating profile"}

def create_share_link(username: str, project_name: str, file_path: str) -> Dict[str, Any]:
    """Create a shareable link for a file"""
    import uuid
    
    if username not in users_db:
        return {"success": False, "message": "User not found"}
    
    try:
        share_id = str(uuid.uuid4())[:8]  # Short unique ID
        
        # Ensure shared_files exists
        if "shared_files" not in users_db[username]:
            users_db[username]["shared_files"] = {}
        
        users_db[username]["shared_files"][share_id] = {
            "project": project_name,
            "file_path": file_path,
            "created_at": datetime.utcnow().isoformat()
        }
        
        save_users()
        print(f"[AUTH] Created share link {share_id} for {username}/{project_name}/{file_path}")
        return {"success": True, "share_id": share_id}
    
    except Exception as e:
        print(f"[AUTH] Error creating share link: {e}")
        return {"success": False, "message": "Error creating share link"}

def get_shared_file_info(share_id: str) -> Optional[Dict[str, Any]]:
    """Get information about a shared file"""
    for username, user_data in users_db.items():
        shared_files = user_data.get("shared_files", {})
        if share_id in shared_files:
            share_info = shared_files[share_id]
            return {
                "username": username,
                "profile_picture": user_data.get("profile_picture", ""),
                "bio": user_data.get("bio", ""),
                "project": share_info["project"],
                "file_path": share_info["file_path"],
                "created_at": share_info["created_at"]
            }
    return None

def delete_share_link(username: str, share_id: str) -> Dict[str, Any]:
    """Delete a shareable link"""
    if username not in users_db:
        return {"success": False, "message": "User not found"}
    
    try:
        shared_files = users_db[username].get("shared_files", {})
        if share_id in shared_files:
            del shared_files[share_id]
            save_users()
            print(f"[AUTH] Deleted share link {share_id} for {username}")
            return {"success": True, "message": "Share link deleted"}
        else:
            return {"success": False, "message": "Share link not found"}
    
    except Exception as e:
        print(f"[AUTH] Error deleting share link: {e}")
        return {"success": False, "message": "Error deleting share link"}

# Initialize users on import
load_users()

if not users_db:
    print("[AUTH] No registered users found. Waiting for first signup.")


