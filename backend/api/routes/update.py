# update.py
from fastapi import APIRouter, HTTPException
from typing import Dict, Optional, List
from pydantic import BaseModel
from voice.voice import handle_live_command, merge_world, handle_chat_conversation
from world.terrain import generate_heightmap
from world.color_scheme import assign_palette_to_elements

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


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatModifyRequest(BaseModel):
    messages: List[ChatMessage]
    current_world: Optional[Dict] = None
    player_position: Optional[Dict] = None
    player_direction: Optional[Dict] = None


@router.post("/chat-modify")
async def chat_modify(request: ChatModifyRequest) -> Dict:
    """
    Interactive chat endpoint for world modifications.
    Uses handle_chat_conversation from voice.py (same AI system as handle_live_command).
    AI asks clarifying questions before modifying to prevent hallucination.
    """
    try:
        # Convert Pydantic models to dict format for handle_chat_conversation
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]
        
        # Call the chat conversation handler from voice.py
        result = handle_chat_conversation(
            messages=messages,
            current_world=request.current_world,
            player_position=request.player_position
        )
        
        return result
        
    except Exception as e:
        print(f"[Chat Modify ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class ColorUpdateRequest(BaseModel):
    biome: str
    structures: Optional[Dict] = None
    color_palette: List[str]  # List of hex color strings


@router.post("/update-colors")
async def update_colors(request: ColorUpdateRequest) -> Dict:
    """
    Update terrain colors by regenerating heightmap with new color palette.
    """
    try:
        print(f"[UPDATE COLORS] Received request for biome: {request.biome}")
        print(f"[UPDATE COLORS] Color palette: {request.color_palette}")
        print(f"[UPDATE COLORS] Structures: {request.structures}")
        
        if not request.color_palette or len(request.color_palette) == 0:
            raise HTTPException(status_code=400, detail="color_palette is required and cannot be empty")
        
        # Convert structures from array format to count format if needed
        # Frontend sends: {"trees": [...], "rocks": [...]}
        # Backend expects: {"tree": 5, "rock": 3}
        structure_counts = {}
        if request.structures:
            # Map from plural array names to singular count names
            structure_mapping = {
                "trees": "tree",
                "rocks": "rock",
                "peaks": "mountain",
                "buildings": "building",
                "street_lamps": "street_lamp"
            }
            
            for key, value in request.structures.items():
                if isinstance(value, list):
                    # Convert array length to count
                    count_key = structure_mapping.get(key, key.rstrip('s'))  # Remove 's' if not in mapping
                    structure_counts[count_key] = len(value)
                    print(f"[UPDATE COLORS] Converted {key} (array with {len(value)} items) -> {count_key}: {len(value)}")
                elif isinstance(value, (int, float)):
                    # Already a count
                    count_key = structure_mapping.get(key, key.rstrip('s'))
                    structure_counts[count_key] = int(value)
                elif isinstance(value, dict):
                    # Already in count format
                    structure_counts.update(value)
        
        print(f"[UPDATE COLORS] Converted structure counts: {structure_counts}")
        
        # Regenerate terrain with new color palette
        terrain_data = generate_heightmap(
            biome_name=request.biome,
            structures=structure_counts,
            color_palette=request.color_palette
        )
        
        print(f"[UPDATE COLORS] ✅ Terrain regenerated successfully")
        print(f"[UPDATE COLORS] Heightmap shape: {len(terrain_data['heightmap_raw'])}x{len(terrain_data['heightmap_raw'][0])}")
        print(f"[UPDATE COLORS] Color map shape: {len(terrain_data['colour_map_array'])}x{len(terrain_data['colour_map_array'][0])}")
        
        # Assign colors to landscape elements
        color_assignments = assign_palette_to_elements(request.color_palette)
        print(f"[UPDATE COLORS] Color assignments: {list(color_assignments.keys())}")
        
        # Apply colors to structures by updating existing structure data
        # Note: Structures will be re-colored on frontend using the color assignments
        structures_with_colors = {}
        if request.structures:
            # Create structure color mapping
            structures_with_colors = {
                "trees": request.structures.get("trees", []),
                "rocks": request.structures.get("rocks", []),
                "peaks": request.structures.get("peaks", []),
                "buildings": request.structures.get("buildings", []),
                "street_lamps": request.structures.get("street_lamps", [])
            }
            
            # Add color information to tree objects
            if structures_with_colors.get("trees"):
                for tree in structures_with_colors["trees"]:
                    if isinstance(tree, dict):
                        tree["leaf_color"] = color_assignments.get("tree_leaves", "#228B22")
                        tree["trunk_color"] = color_assignments.get("tree_trunk", "#8b4513")
        
        # Return terrain data with color assignments
        response_data = {
            **terrain_data,
            "color_assignments": color_assignments,  # Element color mappings
            "color_palette": request.color_palette   # Original palette for reference
        }
        
        return response_data
        
    except Exception as e:
        print(f"[UPDATE COLORS] ERROR: {e}")
        import traceback
        print("[UPDATE COLORS] Full traceback:")
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))