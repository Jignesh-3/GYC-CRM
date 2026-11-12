import os
from datetime import datetime, timedelta, timezone
from typing import Optional, Any, Dict
import bcrypt
import jwt
from jwt.exceptions import PyJWTError

# 1. Configuration (Set JWT_SECRET_KEY in your .env or environment)
SECRET_KEY = os.getenv("JWT_SECRET_KEY", "your-fallback-super-secure-secret-key-change-this")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24  # 24 hours


# 2. Native Bcrypt Password Hashing
def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verifies a plain-text password against a stored bcrypt hash."""
    try:
        return bcrypt.checkpw(
            plain_password.encode("utf-8"), 
            hashed_password.encode("utf-8")
        )
    except Exception:
        return False


def get_password_hash(password: str) -> str:
    """Hashes a password using native bcrypt."""
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password.encode("utf-8"), salt)
    return hashed.decode("utf-8")


# 3. JWT Token Generation & Verification
def create_access_token(
    user_id: str,
    role: str,
    brand_id: Optional[str] = None,
    influencer_id: Optional[str] = None,
    expires_delta: Optional[timedelta] = None
) -> str:
    """Creates an encoded JWT access token with role and tenancy scopes."""
    expire = datetime.now(timezone.utc) + (
        expires_delta if expires_delta else timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    )
    
    to_encode: Dict[str, Any] = {
        "sub": user_id,
        "role": role,
        "brand_id": brand_id,
        "influencer_id": influencer_id,
        "exp": expire,
        "iat": datetime.now(timezone.utc)
    }
    
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    """Decodes and validates a JWT token. Returns payload dict or None if invalid/expired."""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except PyJWTError:
        return None