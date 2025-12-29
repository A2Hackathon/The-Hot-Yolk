from fastapi import APIRouter, HTTPException
from typing import Dict, Optional
from pydantic import BaseModel
from ...voice.voice import handle_live_command

router = APIRouter()

class ModifyRequest(BaseModel):
    command: str
    current_physics: Optional[Dict] = None
    from_time: Optional[str] = None
    to_time: Optional[str] = None
    progress: float = 1.0

@router.patch("/modify-world")
async def modify_world(request: ModifyRequest) -> Dict:
    """
    Apply live modifications from a voice command.

    Example commands:
        "Add 2 more enemies"
        "Switch to dash"
        "Make it night"
    """
    try:
        if not request.command:
            raise HTTPException(status_code=400, detail="No command provided")

        response = handle_live_command(
            command=request.command,
            current_physics=request.current_physics,
            from_time=request.from_time,
            to_time=request.to_time,
            progress=request.progress
        )

        return response

    except Exception as e:
        print(f"[API] Error modifying world: {e}")
        raise HTTPException(status_code=500, detail=str(e))
