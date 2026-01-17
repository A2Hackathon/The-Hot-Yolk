# update.py
from fastapi import APIRouter, HTTPException
from typing import Dict, Optional
from pydantic import BaseModel
from voice.voice import handle_live_command, merge_world

router = APIRouter()

class ModifyRequest(BaseModel):
    command: str
    current_world: Optional[Dict] = None
    player_position: Optional[Dict] = None
    player_direction: Optional[Dict] = None
    from_time: Optional[str] = None   
    to_time: Optional[str] = None         
    progress: Optional[float] = 1.0
    image_data: Optional[str] = None  # base64 encoded image       

@router.patch("/modify-world")
@router.patch("/modify-world")
async def modify_world(request: ModifyRequest) -> Dict:
    if not request.command:
        raise HTTPException(status_code=400, detail="No command provided")

    try:
        print(f"[API] Received command: {request.command}")
        print(f"[API] Image data provided: {request.image_data is not None}")
        if request.image_data:
            print(f"[API] Image data length: {len(request.image_data)} characters")
            print(f"[API] Image data preview (first 100 chars): {request.image_data[:100]}...")
        print(f"[API] request.current_world type: {type(request.current_world)}")
        print(f"[API] request.current_world value: {request.current_world}")
        
        # Ensure current_world is initialized
        if not request.current_world:
            current_world = {
                "world": {},
                "structures": {},
                "combat": {"enemies": [], "enemy_count": 0},
                "physics": {},
                "spawn_point": {}
            }
            print("[API] Initialized empty current_world")
        else:
            current_world = request.current_world
            print(f"[API] Using provided current_world")

        print(f"[API] Calling handle_live_command with current_world type: {type(current_world)}")
        
        # Pass current world, player position, lighting interpolation params, and image to AI
        ai_diff = handle_live_command(
            command=request.command,
            current_world=current_world,
            player_position=request.player_position,
            player_direction=request.player_direction,
            from_time=request.from_time,
            to_time=request.to_time,
            progress=request.progress,
            image_data=request.image_data
        )

        print(f"[API] AI returned diff")
        print(f"[API] Calling merge_world...")
        
        # Merge AI diff into the current world
        updated_world = merge_world(current_world, ai_diff)

        print(f"[API] Returning updated world")
        
        # Return the updated world
        return updated_world

    except Exception as e:
        print(f"[API] ERROR: {e}")
        print(f"[API] ERROR TYPE: {type(e)}")
        import traceback
        print("[API] Full traceback:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))