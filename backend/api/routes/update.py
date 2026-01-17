# update.py
from fastapi import APIRouter, HTTPException
from typing import Dict, Optional, List
from pydantic import BaseModel
from voice.voice import handle_live_command, merge_world, handle_chat_conversation
from world.terrain import generate_heightmap
from world.color_scheme import assign_palette_to_elements
import re

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
        
        # Check if command requests terrain color change
        command_lower = request.command.lower()
        terrain_color_keywords = ["terrain", "ground", "land", "floor", "surface"]
        color_keywords = ["pink", "red", "blue", "green", "yellow", "purple", "orange", "color", "colour"]
        
        is_terrain_color_request = any(keyword in command_lower for keyword in terrain_color_keywords) and \
                                   any(keyword in command_lower for keyword in color_keywords)
        
        if is_terrain_color_request:
            print(f"[API] Detected terrain color change request: {request.command}")
            
            # Extract color from command (look for hex codes or color names)
            color_hex = None
            hex_match = re.search(r'#([0-9a-fA-F]{6})', command_lower)
            if hex_match:
                color_hex = f"#{hex_match.group(1)}"
            else:
                # Map color names to hex
                color_map = {
                    "pink": "#FFC0CB",
                    "red": "#FF0000",
                    "blue": "#0000FF",
                    "green": "#00FF00",
                    "yellow": "#FFFF00",
                    "purple": "#800080",
                    "orange": "#FFA500"
                }
                for color_name, hex_val in color_map.items():
                    if color_name in command_lower:
                        color_hex = hex_val
                        break
            
            if color_hex:
                print(f"[API] Regenerating terrain with color: {color_hex}")
                
                # Get current biome and structure counts
                biome = updated_world.get("world", {}).get("biome") or \
                        updated_world.get("world", {}).get("biome_name") or \
                        current_world.get("world", {}).get("biome") or \
                        current_world.get("world", {}).get("biome_name") or \
                        "default"
                
                # Get structure counts from current world
                structure_counts = {}
                if updated_world.get("structures"):
                    structure_counts = {
                        "tree": len(updated_world["structures"].get("trees", [])),
                        "rock": len(updated_world["structures"].get("rocks", [])),
                        "building": len(updated_world["structures"].get("buildings", [])),
                        "mountain": len(updated_world["structures"].get("peaks", [])),
                        "street_lamp": len(updated_world["structures"].get("street_lamps", []))
                    }
                
                # Regenerate terrain with new color
                terrain_data = generate_heightmap(
                    biome_name=biome,
                    structures=structure_counts,
                    color_palette=[color_hex]  # Use single color for terrain
                )
                
                # Update world with new terrain data
                if "world" not in updated_world:
                    updated_world["world"] = {}
                
                updated_world["world"]["heightmap_raw"] = terrain_data["heightmap_raw"]
                updated_world["world"]["colour_map_array"] = terrain_data["colour_map_array"]
                
                print(f"[API] ✅ Terrain color updated to {color_hex}")
        
        # Check if command requests structure color change (trees, rocks, buildings, objects)
        # Look for object/structure keywords but NOT terrain keywords (already handled above)
        structure_keywords = ["tree", "trees", "rock", "rocks", "building", "buildings", "object", "objects", "structure", "structures"]
        general_object_keywords = ["object", "objects", "everything", "all", "things", "stuff"]
        
        # Check if this is a structure color request (not terrain)
        has_structure_keyword = any(keyword in command_lower for keyword in structure_keywords)
        has_color_keyword = any(keyword in command_lower for keyword in color_keywords)
        is_not_terrain_request = not is_terrain_color_request  # Already handled terrain above
        
        is_structure_color_request = is_not_terrain_request and has_color_keyword and \
                                     (has_structure_keyword or any(keyword in command_lower for keyword in general_object_keywords))
        
        if is_structure_color_request:
            print(f"[API] Detected structure color change request: {request.command}")
            
            # Extract color from command (look for hex codes or color names)
            color_hex = None
            hex_match = re.search(r'#([0-9a-fA-F]{6})', command_lower)
            if hex_match:
                color_hex = f"#{hex_match.group(1)}"
            else:
                # Map color names to hex
                color_map = {
                    "pink": "#FFC0CB",
                    "red": "#FF0000",
                    "blue": "#0000FF",
                    "green": "#00FF00",
                    "yellow": "#FFFF00",
                    "purple": "#800080",
                    "orange": "#FFA500"
                }
                for color_name, hex_val in color_map.items():
                    if color_name in command_lower:
                        color_hex = hex_val
                        break
            
            if color_hex:
                print(f"[API] Applying color {color_hex} to structures...")
                
                # Ensure structures exist in updated_world
                if "structures" not in updated_world:
                    updated_world["structures"] = {}
                
                # Determine which structures to color based on command
                color_trees = "tree" in command_lower or any(kw in command_lower for kw in ["object", "everything", "all"])
                color_rocks = "rock" in command_lower or any(kw in command_lower for kw in ["object", "everything", "all"])
                color_buildings = "building" in command_lower or any(kw in command_lower for kw in ["object", "everything", "all"])
                
                # Get existing structures from merged world (use existing ones if no changes from AI)
                existing_structures = updated_world.get("structures", {})
                current_structures = current_world.get("structures", {}) if current_world else {}
                
                # Use existing structures if AI didn't modify them
                trees = existing_structures.get("trees", current_structures.get("trees", []))
                rocks = existing_structures.get("rocks", current_structures.get("rocks", []))
                buildings = existing_structures.get("buildings", current_structures.get("buildings", []))
                
                # Apply colors to trees
                if color_trees and trees:
                    print(f"[API] Applying {color_hex} to {len(trees)} trees...")
                    for tree in trees:
                        tree["leaf_color"] = color_hex  # For leaves
                        tree["trunk_color"] = color_hex  # For trunk (can be different, but using same for simplicity)
                    updated_world["structures"]["trees"] = trees
                    print(f"[API] ✅ Updated {len(trees)} trees with color {color_hex}")
                
                # Apply colors to rocks
                if color_rocks and rocks:
                    print(f"[API] Applying {color_hex} to {len(rocks)} rocks...")
                    for rock in rocks:
                        rock["rock_color"] = color_hex
                        rock["color"] = color_hex  # Also set general color field
                    updated_world["structures"]["rocks"] = rocks
                    print(f"[API] ✅ Updated {len(rocks)} rocks with color {color_hex}")
                
                # Apply colors to buildings
                if color_buildings and buildings:
                    print(f"[API] Applying {color_hex} to {len(buildings)} buildings...")
                    for building in buildings:
                        building["building_color"] = color_hex
                        building["color"] = color_hex  # Also set general color field
                    updated_world["structures"]["buildings"] = buildings
                    print(f"[API] ✅ Updated {len(buildings)} buildings with color {color_hex}")
                
                print(f"[API] ✅ Structure colors updated")

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
        
        # Ensure color_palette is a list before checking length
        if not request.color_palette or not isinstance(request.color_palette, list) or len(request.color_palette) == 0:
            raise HTTPException(status_code=400, detail="color_palette is required and must be a non-empty list")
        
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