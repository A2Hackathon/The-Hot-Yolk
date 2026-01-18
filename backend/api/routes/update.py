# update.py
from fastapi import APIRouter, HTTPException
from typing import Dict, Optional, List
from pydantic import BaseModel
from voice.voice import handle_live_command, handle_chat_conversation, merge_world
from world.terrain import generate_heightmap
from world.colour_scheme import assign_palette_to_elements

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

class ChatModifyRequest(BaseModel):
    messages: List[Dict]  # List of {role, content} messages
    current_world: Optional[Dict] = None
    player_position: Optional[Dict] = None
    player_direction: Optional[Dict] = None       

@router.post("/modify-world")
async def modify_world_chat(request: ChatModifyRequest) -> Dict:
    """
    Handle chat-based world modification requests.
    Frontend sends conversation messages, backend responds with AI message.
    """
    # #region agent log
    try:
        import json
        with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"update.py:25","message":"modify_world_chat entry","data":{"method":"POST","messages_count":len(request.messages)},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H1,H2"})+'\n')
    except: pass
    # #endregion
    
    try:
        print(f"[API] Received chat modification request with {len(request.messages)} messages")
        
        # Call handle_chat_conversation to get AI response
        chat_response = handle_chat_conversation(
            messages=request.messages,
            current_world=request.current_world,
            player_position=request.player_position
        )
        
        # #region agent log
        try:
            import json
            with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location":"update.py:42","message":"Chat response received","data":{"ready_to_modify":chat_response.get("ready_to_modify",False),"message_length":len(chat_response.get("message",""))},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H2"})+'\n')
        except: pass
        # #endregion
        
        # Return the AI message (frontend expects {message: "..."})
        return {
            "message": chat_response.get("message", "I'm ready to help modify your world."),
            "ready_to_modify": chat_response.get("ready_to_modify", False)
        }
        
    except Exception as e:
        print(f"[API] Chat error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


@router.patch("/modify-world")
async def modify_world(request: ModifyRequest) -> Dict:
    # #region agent log
    try:
        import json
        with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"update.py:21","message":"modify_world entry","data":{"method":"PATCH","command":request.command},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H1"})+'\n')
    except: pass
    # #endregion
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


class UpdateColorsRequest(BaseModel):
    biome: str
    structures: Optional[Dict] = {}
    color_palette: List[str]


@router.post("/update-colors")
async def update_colors(request: UpdateColorsRequest) -> Dict:
    """
    Update world colors by regenerating terrain with a new color palette.
    Returns new terrain data and color assignments.
    """
    try:
        print(f"[API] Received color update request - biome: {request.biome}, palette: {request.color_palette}")
        print(f"[API] Raw structures received: {request.structures}")
        
        # Normalize structures: convert arrays to counts, handle both singular and plural keys
        structure_counts = {}
        if request.structures:
            # Map frontend structure keys (plural) to backend keys (singular)
            key_mapping = {
                "trees": "tree",
                "rocks": "rock",
                "buildings": "building",
                "peaks": "mountain",
                "street_lamps": "street_lamp",
                "enemies": "enemy"
            }
            
            for key, value in request.structures.items():
                # Check if value is a list (array of objects)
                if isinstance(value, list):
                    count = len(value)
                    # Map plural key to singular if needed
                    backend_key = key_mapping.get(key, key.rstrip('s'))  # Remove 's' if not in mapping
                    structure_counts[backend_key] = count
                elif isinstance(value, (int, float)):
                    # Already a count
                    backend_key = key_mapping.get(key, key.rstrip('s'))
                    structure_counts[backend_key] = int(value)
                # Ignore other types
        
        print(f"[API] Normalized structure counts: {structure_counts}")
        
        # Generate terrain with new color palette
        terrain_data = generate_heightmap(
            biome_name=request.biome,
            structures=structure_counts,
            color_palette=request.color_palette
        )
        
        # Generate color assignments from palette
        color_assignments = {}
        if request.color_palette and isinstance(request.color_palette, list) and len(request.color_palette) > 0:
            print(f"[API] Generating color assignments from palette: {request.color_palette}")
            color_assignments = assign_palette_to_elements(request.color_palette)
            print(f"[API] Generated color assignments: {list(color_assignments.keys())}")
        
        return {
            "heightmap_raw": terrain_data["heightmap_raw"],
            "colour_map_array": terrain_data["colour_map_array"],
            "heightmap_url": terrain_data["heightmap_url"],
            "texture_url": terrain_data["texture_url"],
            "placement_mask": terrain_data["placement_mask"],
            "color_assignments": color_assignments
        }
        
    except Exception as e:
        print(f"[API] ERROR updating colors: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Failed to update colors: {str(e)}")