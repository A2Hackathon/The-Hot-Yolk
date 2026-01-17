from fastapi import APIRouter
import os
from dotenv import load_dotenv

load_dotenv()

router = APIRouter()

@router.get("/health")
async def health_check():
    return {
        "status": "ok",
        "message": "AI World Builder backend is online"
    }

@router.get("/overshoot-api-key")
async def get_overshoot_api_key():
    """
    Returns the Overshoot API key from .env file if available.
    Used by frontend to automatically configure Overshoot SDK.
    """
    api_key = os.getenv("OVERSHOOT_API_KEY")
    if api_key:
        return {
            "api_key": api_key,
            "available": True
        }
    else:
        return {
            "api_key": None,
            "available": False
        }
