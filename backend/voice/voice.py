# voice.py
from typing import Dict, Optional
import sounddevice as sd
import numpy as np
import queue
import json
import os
import random
import math
from world.lighting import get_lighting_preset, interpolate_lighting  
from openai import OpenAI

"""
voice.py
--------
Responsible for:
- capturing voice input
- converting speech to text
- using Claude 4.1 Opus to infer player intent and modify the world
"""

# Create a queue to hold audio chunks
audio_queue = queue.Queue()

# Initialize Claude client
claude_client = OpenAI(
    api_key=os.getenv("CLAUDE_API_KEY"),
    base_url="https://openrouter.ai/api/v1" 
)

def record_audio(duration: float = 5.0, fs: int = 44100) -> np.ndarray:
    print("[Voice] Recording audio...")
    recording = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype='int16')
    sd.wait()
    print("[Voice] Recording finished")
    return recording.flatten()


def summarize_world(world: Dict) -> Dict:
    """
    Produce a lightweight summary of the world for AI input.
    Only include key info AI needs to make modifications.
    """
    if not world:
        world = {}

    # Include full tree data if present (needed for "set" operations with image styling)
    structures = world.get("structures", {})
    tree_data = structures.get("trees", [])
    
    return {
        "biome": world.get("world", {}).get("biome"),
        "time": world.get("world", {}).get("time"),
        "sky_colour": world.get("world", {}).get("sky_colour"),
        "structures": {k: len(v) for k, v in structures.items()},
        "combat": {
            "enemy_count": world.get("combat", {}).get("enemy_count", 0)
        },
        # Include existing trees for "set" operations (especially for image styling)
        "existing_trees": tree_data[:10] if tree_data else []  # Include first 10 as examples
    }


def generate_new_buildings(count: int, biome: str, existing_buildings: list, terrain_size: float = 256.0) -> list:
    """Generate new building objects with proper positions"""
    if biome.lower() != "city":
        return []
    
    buildings = []
    building_types = [
        {"height": 25, "width": 8, "depth": 8, "color": 0x666666},
        {"height": 18, "width": 10, "depth": 7, "color": 0x888888},
        {"height": 15, "width": 7, "depth": 10, "color": 0x777777},
        {"height": 35, "width": 8, "depth": 8, "color": 0x555555},
        {"height": 28, "width": 9, "depth": 9, "color": 0x444444},
    ]
    
    # Extract existing positions
    existing_positions = [(b["position"]["x"], b["position"]["z"]) for b in existing_buildings]
    min_distance = 25
    
    attempts = 0
    max_attempts = count * 50
    
    while len(buildings) < count and attempts < max_attempts:
        attempts += 1
        
        # Random position
        world_x = random.uniform(-terrain_size/2 + 20, terrain_size/2 - 20)
        world_z = random.uniform(-terrain_size/2 + 20, terrain_size/2 - 20)
        
        # Check distance from existing buildings
        too_close = False
        for px, pz in existing_positions:
            dist = math.sqrt((world_x - px)**2 + (world_z - pz)**2)
            if dist < min_distance:
                too_close = True
                break
        
        if too_close:
            continue
        
        # Choose random building type
        building_type = random.choice(building_types)
        rotation = random.choice([0, math.pi/2, math.pi, 3*math.pi/2])
        
        building = {
            "type": "building",
            "height": building_type["height"],
            "width": building_type["width"],
            "depth": building_type["depth"],
            "color": building_type["color"],
            "position": {"x": float(world_x), "y": 0, "z": float(world_z)},
            "rotation": float(rotation)
        }
        
        buildings.append(building)
        existing_positions.append((world_x, world_z))
    
    print(f"[VOICE] Generated {len(buildings)} new buildings")
    return buildings


def detect_and_remove_blocking_structures(diff: Dict, current_world: Dict, collision_radius: float = 5.0) -> Dict:
    """
    Automatically detect structures blocking new placements and add removal operations.
    
    Args:
        diff: The AI-generated diff with additions
        current_world: Current world state to check against
        collision_radius: Distance threshold for collision detection (default 5 units)
    
    Returns:
        Updated diff with automatic removals added
    """
    if not diff.get("add"):
        return diff
    
    # Ensure remove field exists
    if "remove" not in diff:
        diff["remove"] = {}
    
    structures = current_world.get("structures", {})
    
    # Check trees being added
    if diff["add"].get("trees"):
        trees_to_add = diff["add"]["trees"]
        if isinstance(trees_to_add, list):
            existing_trees = structures.get("trees", [])
            blocking_count = 0
            
            for new_tree in trees_to_add:
                if "position" in new_tree:
                    new_x = new_tree["position"].get("x", 0)
                    new_z = new_tree["position"].get("z", 0)
                    
                    # Check against existing trees
                    for existing_tree in existing_trees:
                        if "position" in existing_tree:
                            ex_x = existing_tree["position"].get("x", 0)
                            ex_z = existing_tree["position"].get("z", 0)
                            dist = math.sqrt((new_x - ex_x)**2 + (new_z - ex_z)**2)
                            if dist < collision_radius:
                                blocking_count += 1
                                break
                    
                    # Check against other structure types
                    for struct_type in ["rocks", "buildings", "street_lamps", "peaks"]:
                        existing_structs = structures.get(struct_type, [])
                        for existing in existing_structs:
                            if "position" in existing:
                                ex_x = existing["position"].get("x", 0)
                                ex_z = existing["position"].get("z", 0)
                                dist = math.sqrt((new_x - ex_x)**2 + (new_z - ex_z)**2)
                                if dist < collision_radius:
                                    # Add removal for this structure type
                                    if struct_type == "buildings":
                                        # Check if it's a house or skyscraper
                                        building_type = existing.get("type", "house")
                                        if building_type == "skyscraper":
                                            diff["remove"]["skyscrapers"] = diff["remove"].get("skyscrapers", 0) + 1
                                        else:
                                            diff["remove"]["houses"] = diff["remove"].get("houses", 0) + 1
                                    else:
                                        diff["remove"][struct_type] = diff["remove"].get(struct_type, 0) + 1
                                    break
            
            if blocking_count > 0:
                diff["remove"]["trees"] = diff["remove"].get("trees", 0) + blocking_count
                print(f"[COLLISION] Auto-removing {blocking_count} blocking trees")
    
    # Check rocks being added
    if diff["add"].get("rocks"):
        rocks_to_add = diff["add"]["rocks"]
        if isinstance(rocks_to_add, list):
            existing_rocks = structures.get("rocks", [])
            blocking_count = 0
            
            for new_rock in rocks_to_add:
                if "position" in new_rock:
                    new_x = new_rock["position"].get("x", 0)
                    new_z = new_rock["position"].get("z", 0)
                    
                    # Check against existing structures
                    for struct_type in ["trees", "rocks", "buildings", "street_lamps", "peaks"]:
                        existing_structs = structures.get(struct_type, [])
                        for existing in existing_structs:
                            if "position" in existing:
                                ex_x = existing["position"].get("x", 0)
                                ex_z = existing["position"].get("z", 0)
                                dist = math.sqrt((new_x - ex_x)**2 + (new_z - ex_z)**2)
                                if dist < collision_radius:
                                    if struct_type == "buildings":
                                        building_type = existing.get("type", "house")
                                        if building_type == "skyscraper":
                                            diff["remove"]["skyscrapers"] = diff["remove"].get("skyscrapers", 0) + 1
                                        else:
                                            diff["remove"]["houses"] = diff["remove"].get("houses", 0) + 1
                                    else:
                                        diff["remove"][struct_type] = diff["remove"].get(struct_type, 0) + 1
                                    blocking_count += 1
                                    break
                        if blocking_count > 0:
                            break
            
            if blocking_count > 0:
                diff["remove"]["rocks"] = diff["remove"].get("rocks", 0) + blocking_count
                print(f"[COLLISION] Auto-removing {blocking_count} blocking structures for rock placement")
    
    # Check peaks being added
    if diff["add"].get("peaks"):
        peaks_to_add = diff["add"]["peaks"]
        if isinstance(peaks_to_add, list):
            for new_peak in peaks_to_add:
                if "position" in new_peak:
                    new_x = new_peak["position"].get("x", 0)
                    new_z = new_peak["position"].get("z", 0)
                    
                    # Check against existing structures (larger radius for peaks)
                    peak_radius = 10.0
                    for struct_type in ["trees", "rocks", "buildings", "street_lamps", "peaks"]:
                        existing_structs = structures.get(struct_type, [])
                        for existing in existing_structs:
                            if "position" in existing:
                                ex_x = existing["position"].get("x", 0)
                                ex_z = existing["position"].get("z", 0)
                                dist = math.sqrt((new_x - ex_x)**2 + (new_z - ex_z)**2)
                                if dist < peak_radius:
                                    if struct_type == "buildings":
                                        building_type = existing.get("type", "house")
                                        if building_type == "skyscraper":
                                            diff["remove"]["skyscrapers"] = diff["remove"].get("skyscrapers", 0) + 1
                                        else:
                                            diff["remove"]["houses"] = diff["remove"].get("houses", 0) + 1
                                    else:
                                        diff["remove"][struct_type] = diff["remove"].get(struct_type, 0) + 1
                                    print(f"[COLLISION] Auto-removing blocking {struct_type} for peak placement")
    
    return diff


def calculate_relative_position(
    relative_term: str,
    player_position: Dict,
    player_direction: Optional[Dict] = None,
    distance: float = 10.0
) -> Dict:
    """
    Calculate absolute position from relative positioning terms.
    
    Args:
        relative_term: One of "front", "behind", "left", "right", "near", "far"
        player_position: Dict with x, y, z
        player_direction: Optional dict with x, z components (normalized direction vector)
        distance: Distance from player (default 10 units)
    
    Returns:
        Dict with absolute x, y, z position
    """
    px = player_position.get("x", 0)
    py = player_position.get("y", 0)
    pz = player_position.get("z", 0)
    
    if not player_direction:
        # Default to positive Z direction if no direction provided
        dir_x, dir_z = 0.0, 1.0
    else:
        dir_x = player_direction.get("x", 0)
        dir_z = player_direction.get("z", 1)
        # Normalize
        length = math.sqrt(dir_x**2 + dir_z**2)
        if length > 0:
            dir_x /= length
            dir_z /= length
    
    relative_term = relative_term.lower().strip()
    
    if relative_term in ["front", "ahead", "in front", "in front of me", "ahead of me"]:
        x = px + dir_x * distance
        z = pz + dir_z * distance
    elif relative_term in ["behind", "behind me", "back", "backward"]:
        x = px - dir_x * distance
        z = pz - dir_z * distance
    elif relative_term in ["left", "to my left", "on my left"]:
        # Perpendicular to the left (rotate direction 90° counterclockwise)
        x = px - dir_z * distance
        z = pz + dir_x * distance
    elif relative_term in ["right", "to my right", "on my right"]:
        # Perpendicular to the right (rotate direction 90° clockwise)
        x = px + dir_z * distance
        z = pz - dir_x * distance
    elif relative_term in ["near", "close", "near me", "close to me"]:
        # Random position within 10-20 units
        angle = random.uniform(0, math.pi * 2)
        dist = random.uniform(10, 20)
        x = px + math.cos(angle) * dist
        z = pz + math.sin(angle) * dist
    elif relative_term in ["far", "far from me", "away", "away from me"]:
        # Random position 30+ units away
        angle = random.uniform(0, math.pi * 2)
        dist = random.uniform(30, 50)
        x = px + math.cos(angle) * dist
        z = pz + math.sin(angle) * dist
    else:
        # Default to in front
        x = px + dir_x * distance
        z = pz + dir_z * distance
    
    return {"x": float(x), "y": 0.0, "z": float(z)}


def generate_new_street_lamps(count: int, biome: str, existing_street_lamps: list, terrain_size: float = 256.0) -> list:
    """Generate new street lamp objects with proper positions"""
    if biome.lower() != "city":
        return []
    
    street_lamps = []
    
    # Extract existing positions
    existing_positions = [(l["position"]["x"], l["position"]["z"]) for l in existing_street_lamps]
    min_distance = 15
    
    attempts = 0
    max_attempts = count * 50
    
    # Limit placement range to be closer to center (within 60 units of center)
    center_range = 60
    
    while len(street_lamps) < count and attempts < max_attempts:
        attempts += 1
        
        # Random position within center range
        world_x = random.uniform(-center_range, center_range)
        world_z = random.uniform(-center_range, center_range)
        
        # Check distance from existing street lamps
        too_close = False
        for px, pz in existing_positions:
            dist = math.sqrt((world_x - px)**2 + (world_z - pz)**2)
            if dist < min_distance:
                too_close = True
                break
        
        if too_close:
            continue
        
        scale = random.uniform(0.9, 1.1)
        rotation = random.uniform(0, math.pi * 2)
        
        street_lamp = {
            "position": {"x": float(world_x), "y": 0, "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        }
        
        street_lamps.append(street_lamp)
        existing_positions.append((world_x, world_z))
    
    print(f"[VOICE] Generated {len(street_lamps)} new street lamps")
    return street_lamps


def generate_new_enemies(count: int, existing_enemies: list, terrain_size: float = 256.0) -> list:
    """Generate new enemy objects with proper positions"""
    enemies = []
    existing_positions = [(e["position"]["x"], e["position"]["z"]) for e in existing_enemies if "position" in e]
    min_distance = 10
    
    attempts = 0
    max_attempts = count * 50
    
    while len(enemies) < count and attempts < max_attempts:
        attempts += 1
        
        # Random position
        world_x = random.uniform(-terrain_size/2 + 10, terrain_size/2 - 10)
        world_z = random.uniform(-terrain_size/2 + 10, terrain_size/2 - 10)
        
        # Check distance from existing enemies
        too_close = False
        for px, pz in existing_positions:
            dist = math.sqrt((world_x - px)**2 + (world_z - pz)**2)
            if dist < min_distance:
                too_close = True
                break
        
        if too_close:
            continue
        
        enemy = {
            "id": len(existing_enemies) + len(enemies) + 1,
            "position": {"x": float(world_x), "y": 0, "z": float(world_z)},
            "type": "sentinel",
            "behavior": "patrol",
            "health": 30,
            "max_health": 30,
            "damage": 10,
            "speed": 2.5,
            "detection_radius": 15.0,
            "attack_radius": 1.5
        }
        
        enemies.append(enemy)
        existing_positions.append((world_x, world_z))
    
    print(f"[VOICE] Generated {len(enemies)} new enemies")
    return enemies


def handle_live_command(
    command: str,
    current_world: Optional[Dict] = None,
    player_position: Optional[Dict] = None,
    player_direction: Optional[Dict] = None,
    from_time: Optional[str] = None,
    to_time: Optional[str] = None,
    progress: Optional[float] = 1.0,
    image_data: Optional[str] = None
) -> Dict:
    # Log immediately if image is provided
    if image_data:
        print(f"[VOICE] ===== IMAGE RECEIVED =====")
        print(f"[VOICE] Image data length: {len(image_data) if image_data else 0} characters")
        print(f"[VOICE] Command: {command}")
    else:
        print(f"[VOICE] No image data provided")
    """
    Fully AI-driven command handler using Claude 4.1.

    Args:
        command: Player command as text
        current_world: Optional dict of current world state
        from_time: Starting time of day for interpolation
        to_time: Target time of day for interpolation
        progress: 0.0 to 1.0, interpolation progress

    Returns:
        A dict delta describing what to add/change in the world
    """
    if current_world is None:
        current_world = {
            "world": {},
            "structures": {},
            "combat": {},
            "physics": {},
            "spawn_point": {}
        }

    world_summary = summarize_world(current_world)
    current_biome = current_world.get("world", {}).get("biome", "city")

    system_prompt = """
You are a game world editor AI.

Rules:
- Output ONLY valid JSON matching this structure:
{
  "add": {"trees": [], "buildings": [], "peaks": [], "rocks": [], "street_lamps": [], "enemies": []},
  "remove": {"trees": 0, "buildings": 0, "skyscrapers": 0, "houses": 0, "peaks": 0, "rocks": 0, "street_lamps": 0, "enemies": 0},
  "set": {"trees": null, "buildings": null, "skyscrapers": null, "houses": null, "peaks": null, "rocks": null, "street_lamps": null, "enemies": null},
  "physics": null,
  "lighting": null,
  "combat": null,
  "message": null,
  "time_change": null
}

MODIFICATION TYPES:
1. ADD: Use "add" field
   - "add 5 trees" → {"add": {"trees": [5 tree objects]}}
   - "add 3 buildings" → {"add": {"buildings": 3}}  // Just the count!
   - "add 4 enemies" → {"add": {"enemies": 4}}      // Just the count!
   - "add 10 street lamps" → {"add": {"street_lamps": 10}}  // Just the count!
   - "add street lamps" → {"add": {"street_lamps": 10}}  // Default to 10 if no number
   
2. REMOVE: Use "remove" to delete structures
   - "remove 3 buildings" → {"remove": {"buildings": 3}}  // Removes any buildings
   - "remove all skyscrapers" → {"remove": {"skyscrapers": 999}}  // Removes ONLY skyscrapers, nothing else
   - "remove all houses" → {"remove": {"houses": 999}}  // Removes ONLY houses, nothing else
   - "remove 2 skyscrapers" → {"remove": {"skyscrapers": 2}}
   - "remove 5 houses" → {"remove": {"houses": 5}}
   - "remove all trees" → {"remove": {"trees": 999}}  // Removes ONLY trees, nothing else
   - "remove 5 street lamps" → {"remove": {"street_lamps": 5}}
   - "delete 2 enemies" → {"remove": {"enemies": 2}}
   
CRITICAL: When user says "remove all X", ONLY remove X. Do NOT remove other structure types.
   - "remove all trees" → {"remove": {"trees": 999}}  // ONLY trees, no houses, no buildings, nothing else
   - "remove all houses" → {"remove": {"houses": 999}}  // ONLY houses, no skyscrapers, no trees, nothing else
   - If user specifies a specific type, ONLY modify that type. Never modify other types unless explicitly requested.
   
3. SET: Use "set" to change total count
   - "set trees to 10" → {"set": {"trees": 10}}
   - "I want exactly 5 buildings" → {"set": {"buildings": 5}}
   - "set skyscrapers to 3" → {"set": {"skyscrapers": 3}}
   - "set houses to 10" → {"set": {"houses": 10}}
   - "set street lamps to 15" → {"set": {"street_lamps": 15}}

IMPORTANT FOR BUILDINGS, ENEMIES, AND STREET_LAMPS:
- For "add buildings", "add enemies", or "add street_lamps", return ONLY THE COUNT as a number
- Backend will generate positions and full objects automatically
- Example: {"add": {"buildings": 5}} NOT {"add": {"buildings": [...]}}
- Example: {"add": {"street_lamps": 10}} NOT {"add": {"street_lamps": [...]}}
- If user says "add street lamps" or "streetlamps" without a number, default to 10

IMPORTANT FOR OTHER STRUCTURES (trees, rocks, peaks):
- For trees/rocks/peaks, you must generate full objects with positions
- Example: {"add": {"trees": [{"type": "oak", "position": {...}, ...}]}}

4. CLEAR: Use remove with high number
   - "remove all buildings" → {"remove": {"buildings": 999}}  // Removes all buildings (both types)
   - "remove all skyscrapers" → {"remove": {"skyscrapers": 999}}  // Removes only skyscrapers
   - "remove all houses" → {"remove": {"houses": 999}}  // Removes only houses
   - "clear enemies" → {"remove": {"enemies": 999}}
   - "remove all street lamps" → {"remove": {"street_lamps": 999}}

IMPORTANT: SKYSCRAPERS vs HOUSES vs BUILDINGS
- "skyscrapers" and "houses" are separate building types
- Use "skyscrapers" to target ONLY tall buildings
- Use "houses" to target ONLY regular houses
- Use "buildings" to target ALL buildings (both types)
- When user says "remove all trees", ONLY remove trees - do NOT remove buildings, houses, or anything else
- When user says "remove all houses", ONLY remove houses - do NOT remove skyscrapers, trees, or anything else
- When user says "remove all buildings", remove BOTH houses AND skyscrapers
- Be precise: if user specifies one type, ONLY modify that type

TREE/ROCK/PEAK GENERATION:
- Trees need: type, leafless, position {x, y, z}, scale, rotation
- Rocks need: type, position {x, y, z}, scale, rotation
- Peaks need: type, position {x, y, z}, scale

TREE STYLING FROM IMAGES:
- If an image is provided with the command, analyze the tree(s) in the image
- Extract visual features: leaf colors (dominant green shades), trunk color (brown/gray tones), overall shape (tall/short, wide/narrow), size proportions
- When modifying trees to match an image:
  - Use "set" operation to update ALL existing trees with new styling parameters
  - Include color information in tree objects: "leaf_color" (hex color string like "#4BBB6D"), "trunk_color" (hex color string like "#ab7354")
  - CRITICAL: When using "set", you MUST include ALL existing tree objects with their original properties PLUS the new color properties
  - Example format for "set" trees:
    {
      "set": {
        "trees": [
          {
            "type": "oak",
            "leafless": false,
            "position": {"x": 10.0, "y": 0.0, "z": 20.0},
            "scale": 1.2,
            "rotation": 0.5,
            "leaf_color": "#2d5016",  // NEW: extracted from image
            "trunk_color": "#8b4513"   // NEW: extracted from image
          },
          // ... include ALL existing trees with updated colors
        ]
      }
    }
  - Adjust scale ranges if trees in image are significantly different sizes
  - Example: If image shows dark green coniferous trees, set leaf_color to darker green shades like "#2d5016" or "#1a3d0a"
  - Example: If image shows autumn trees, use warmer colors like "#d2691e" (orange), "#8b0000" (dark red), "#daa520" (golden)
  - Color format: Always use hex strings starting with "#" (e.g., "#4BBB6D" not 0x4BBB6D or 4941757)
- For commands like "make trees look like this" or "style trees like the image":
  - Analyze the image first - describe what you see (colors, shapes, style)
  - Extract dominant colors from leaves and trunk
  - Convert colors to hex format (e.g., dark green = "#2d5016", brown trunk = "#8b4513")
  - Use "set" with ALL existing trees, adding leaf_color and trunk_color to each tree object
  - If user wants to add NEW trees matching the image, use "add" with styled tree objects including leaf_color and trunk_color

RELATIVE POSITIONING:
- If player position is provided, you MUST calculate ABSOLUTE positions from relative terms:
  - "in front of me" / "ahead of me" → Calculate: player_x + (dir_x * 10), player_z + (dir_z * 10)
  - "behind me" / "behind" → Calculate: player_x - (dir_x * 10), player_z - (dir_z * 10)
  - "next to me" / "beside me" / "to my side" → Randomly choose left or right, then calculate
  - "to my left" → Calculate: player_x - (dir_z * 8), player_z + (dir_x * 8) [perpendicular left]
  - "to my right" → Calculate: player_x + (dir_z * 8), player_z - (dir_x * 8) [perpendicular right]
  - "near me" / "close to me" → Random angle, distance 10-20 units from player
  - "far from me" / "away from me" → Random angle, distance 30-50 units from player
- IMPORTANT: You MUST return absolute numeric positions, NOT relative terms like "in front of me"
- Example: If player is at (10, 5, 20) facing direction (0, 0, 1), "in front" = (10, 0, 30)
- Always set y = 0 for ground-level objects (terrain height will be calculated automatically)
- Calculate positions using the player_position and player_direction provided in the context

AUTOMATIC COLLISION REMOVAL:
- When placing structures at specific locations (especially with relative positioning), you MUST check if other structures are blocking that location
- If a structure is being placed at a specific position, automatically remove any existing structures within 5 units of that position
- Add removal operations in the "remove" field BEFORE adding the new structure
- Example: If placing a tree at (10, 0, 20) and there's a rock at (11, 0, 19), add {"remove": {"rocks": 1}} to remove the blocking rock
- Check for collisions with: trees, rocks, buildings, street_lamps, peaks
- For buildings, check both "houses" and "skyscrapers" separately
- Collision radius: 5 units for most structures, 8 units for buildings
- Always remove blocking structures automatically - the user expects clear placement

BUILDING/ENEMY/STREET_LAMP GENERATION:
- Just return count as number, backend handles generation
- Example: "add 5 buildings" → {"add": {"buildings": 5}}
- Example: "add 3 enemies" → {"add": {"enemies": 3}}
- Example: "add 10 street lamps" → {"add": {"street_lamps": 10}}
- Example: "add street lamps" or "streetlamps" → {"add": {"street_lamps": 10}}
"""

    # Build player context for relative positioning
    player_context = ""
    if player_position:
        player_context = f"\nPlayer position: x={player_position.get('x', 0):.1f}, y={player_position.get('y', 0):.1f}, z={player_position.get('z', 0):.1f}"
        if player_direction:
            player_context += f"\nPlayer facing direction: x={player_direction.get('x', 0):.2f}, z={player_direction.get('z', 0):.2f}"
        player_context += "\nYou can use relative positioning terms like 'in front of me', 'behind me', 'next to me', etc."
    
    # Include existing trees info if image is provided (needed for styling)
    existing_trees_info = ""
    if image_data:
        all_trees = current_world.get("structures", {}).get("trees", [])
        tree_count = len(all_trees)
        if all_trees:
            # Include first few as examples, but tell AI to include ALL
            example_trees = all_trees[:5]  # First 5 as examples
            existing_trees_info = f"\n\nIMPORTANT: There are {tree_count} existing trees in the world. Example trees (first 5):\n{json.dumps(example_trees, indent=2)}\n\nCRITICAL: When using 'set' to style trees based on the image, you MUST include ALL {tree_count} existing trees with their original properties (type, position, scale, rotation, leafless) PLUS add the new leaf_color and trunk_color fields extracted from the image. Do NOT just include the example trees - include ALL trees from the current world."
    
    user_prompt = f"""
World summary:
{json.dumps(world_summary)}
{player_context}
{existing_trees_info}

Player command:
"{command}"
"""

    # Build messages array - include image if provided
    messages = [
        {"role": "system", "content": system_prompt}
    ]
    
    if image_data:
        # Image provided - use vision API format
        # Remove data URL prefix if present (data:image/png;base64,)
        image_base64 = image_data
        media_type = "image/jpeg"  # Default
        
        if ',' in image_data:
            # Extract media type from data URL
            prefix = image_data.split(',')[0]
            if 'image/png' in prefix:
                media_type = "image/png"
            elif 'image/jpeg' in prefix or 'image/jpg' in prefix:
                media_type = "image/jpeg"
            elif 'image/gif' in prefix:
                media_type = "image/gif"
            elif 'image/webp' in prefix:
                media_type = "image/webp"
            image_base64 = image_data.split(',')[1]
        
        messages.append({
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_base64
                    }
                },
                {
                    "type": "text",
                    "text": user_prompt + "\n\n" + "="*80 + "\n" + "IMAGE ANALYSIS REQUIRED - READ CAREFULLY" + "\n" + "="*80 + "\n\n" +
                    "AN IMAGE HAS BEEN UPLOADED. You MUST analyze it before responding.\n\n" +
                    "STEP 1: ANALYZE THE IMAGE\n" +
                    "- Look at the image carefully\n" +
                    "- Identify the DOMINANT leaf color (e.g., green, red, orange, yellow, brown)\n" +
                    "- Identify the DOMINANT trunk/bark color (e.g., brown, gray, dark brown)\n" +
                    "- Note the overall shape (tall, short, wide, narrow, bushy, sparse)\n" +
                    "- Note any distinctive features (autumn colors, coniferous, deciduous, etc.)\n\n" +
                    "STEP 2: CONVERT COLORS TO HEX\n" +
                    "Common color conversions:\n" +
                    "- Green leaves: '#228B22' (forest green), '#2d5016' (dark green), '#4BBB6D' (bright green)\n" +
                    "- Red/Autumn leaves: '#8B0000' (dark red), '#CD5C5C' (Indian red), '#DC143C' (crimson), '#A52A2A' (brown red)\n" +
                    "- Orange/Autumn leaves: '#FF8C00' (dark orange), '#FF6347' (tomato), '#FF4500' (orange red)\n" +
                    "- Yellow/Autumn leaves: '#FFD700' (gold), '#FFA500' (orange), '#DAA520' (goldenrod)\n" +
                    "- Brown trunks: '#8b4513' (saddle brown), '#654321' (dark brown), '#A0522D' (sienna)\n" +
                    "- Gray trunks: '#808080' (gray), '#696969' (dim gray), '#2F4F4F' (dark slate gray)\n\n" +
                    "STEP 3: BUILD THE RESPONSE\n" +
                    "You MUST use \"set\" with an ARRAY of ALL existing trees.\n" +
                    "For EACH tree in the existing trees list above:\n" +
                    "1. Copy ALL original properties (type, position, scale, rotation, leafless)\n" +
                    "2. ADD \"leaf_color\" field with hex color from image analysis\n" +
                    "3. ADD \"trunk_color\" field with hex color from image analysis\n" +
                    "4. If the image shows autumn/red/orange/yellow leaves, use those colors\n" +
                    "5. If the image shows green leaves, use green shades\n\n" +
                    "EXAMPLE RESPONSE:\n" +
                    "{\n" +
                    "  \"set\": {\n" +
                    "    \"trees\": [\n" +
                    "      {\n" +
                    "        \"type\": \"oak\",\n" +
                    "        \"leafless\": false,\n" +
                    "        \"position\": {\"x\": -112.94, \"y\": 4.60, \"z\": -27.61},\n" +
                    "        \"scale\": 2.10,\n" +
                    "        \"rotation\": 1.93,\n" +
                    "        \"leaf_color\": \"#8B0000\",\n" +
                    "        \"trunk_color\": \"#8b4513\"\n" +
                    "      },\n" +
                    "      // ... ALL other existing trees with same structure + colors\n" +
                    "    ]\n" +
                    "  }\n" +
                    "}\n\n" +
                    "CRITICAL RULES:\n" +
                    "- DO NOT return just a count\n" +
                    "- DO NOT skip any trees\n" +
                    "- EVERY tree MUST have leaf_color and trunk_color fields\n" +
                    "- Use hex format with # prefix (e.g., \"#8B0000\" not 0x8B0000 or 9114624)\n" +
                    "- If you see red/autumn colors in the image, use red/orange/yellow hex codes\n" +
                    "- If you see green in the image, use green hex codes"
                }
            ]
        })
        print(f"[VOICE] Image provided - using vision API for tree styling (media_type: {media_type})")
        print(f"[VOICE] Image data length: {len(image_base64)} characters")
        print(f"[VOICE] Command with image: {command}")
    else:
        # No image - regular text prompt
        messages.append({
            "role": "user",
            "content": user_prompt
        })

    try:
        response = claude_client.chat.completions.create(
            model="anthropic/claude-opus-4",
            messages=messages,
            max_tokens=4000,
            temperature=0.2
        )
        raw = response.choices[0].message.content.strip()
        
        # Extract JSON from response - handle cases where Claude includes descriptive text
        # Strategy: Find the JSON code block or the first { character
        
        # First, try to find a JSON code block
        json_block_start = raw.find("```json")
        if json_block_start == -1:
            json_block_start = raw.find("```")
        
        if json_block_start != -1:
            # Found code block - extract everything from the opening fence
            raw = raw[json_block_start:]
            # Remove opening fence
            if raw.startswith("```json"):
                raw = raw[7:].lstrip()
            elif raw.startswith("```"):
                raw = raw[3:].lstrip()
            # Find and remove closing fence
            json_block_end = raw.rfind("```")
            if json_block_end != -1:
                raw = raw[:json_block_end].rstrip()
            raw = raw.strip()
        else:
            # No code block found - look for first { character (start of JSON object)
            json_start = raw.find('{')
            if json_start != -1 and json_start > 0:
                # There's text before the JSON - extract only the JSON part
                raw = raw[json_start:]
                print(f"[VOICE] Found JSON after {json_start} characters of descriptive text")
            # Still try to strip any remaining markdown fences (just in case)
            if raw.startswith("```json"):
                raw = raw[7:].lstrip()
            if raw.startswith("```"):
                raw = raw[3:].lstrip()
            json_block_end = raw.rfind("```")
            if json_block_end != -1:
                raw = raw[:json_block_end].rstrip()
            raw = raw.strip()
        
        print(f"[CLAUDE DEBUG] Cleaned JSON length: {len(raw)} chars")
        print(f"[CLAUDE DEBUG] Cleaned JSON (first 300 chars): {raw[:300]}...")
        
        # Final check: if the cleaned JSON still starts with text (not {), find the first {
        if not raw.strip().startswith('{'):
            json_obj_start = raw.find('{')
            if json_obj_start != -1:
                print(f"[VOICE] WARNING: Cleaned JSON still has text before {{. Extracting from position {json_obj_start}")
                raw = raw[json_obj_start:]
            else:
                print(f"[VOICE] ERROR: No {{ found in cleaned JSON!")
        
        # Check if response mentions image analysis or colors (before parsing)
        if image_data:
            if "color" in raw.lower() or "red" in raw.lower() or "green" in raw.lower() or "autumn" in raw.lower():
                print(f"[VOICE] AI response mentions colors/autumn - checking for color parameters...")
            if "tree" in raw.lower():
                print(f"[VOICE] AI response mentions trees")
        
        # Try to parse JSON
        try:
            diff = json.loads(raw)
            print(f"[VOICE] ✓ Successfully parsed JSON")
        except json.JSONDecodeError as e:
            print(f"[VOICE] JSON parsing error: {e}")
            print(f"[VOICE] Attempting to extract JSON from malformed response...")
            # Last resort: try to find and extract just the JSON object
            # Look for the outermost { ... } pair
            first_brace = raw.find('{')
            if first_brace != -1:
                # Find matching closing brace by counting
                brace_count = 0
                json_end = -1
                for i in range(first_brace, len(raw)):
                    if raw[i] == '{':
                        brace_count += 1
                    elif raw[i] == '}':
                        brace_count -= 1
                        if brace_count == 0:
                            json_end = i + 1
                            break
                
                if json_end != -1:
                    raw = raw[first_brace:json_end]
                    print(f"[VOICE] Extracted JSON object (positions {first_brace} to {json_end})")
                    try:
                        diff = json.loads(raw)
                        print(f"[VOICE] ✓ Successfully parsed extracted JSON")
                    except json.JSONDecodeError as e2:
                        print(f"[VOICE] Still failed to parse: {e2}")
                        raise
                else:
                    print(f"[VOICE] Could not find matching closing brace")
                    raise
            else:
                raise
        
        # Log what operations the AI used
        print(f"[VOICE] AI used operations: set={bool(diff.get('set'))}, add={bool(diff.get('add'))}, remove={bool(diff.get('remove'))}")
        if diff.get("set"):
            print(f"[VOICE] Set operations: {list(diff['set'].keys())}")
        if diff.get("add"):
            print(f"[VOICE] Add operations: {list(diff['add'].keys())}")
        
        # UNIVERSAL FALLBACK: If image provided, ensure ALL trees have colors (regardless of operation)
        if image_data:
            all_trees = []
            trees_source = None
            
            # Collect all trees from any operation
            if diff.get("set", {}).get("trees"):
                all_trees = diff["set"]["trees"]
                trees_source = "set"
            elif diff.get("add", {}).get("trees"):
                all_trees = diff["add"]["trees"]
                trees_source = "add"
            
            # Check if any trees are missing colors
            if all_trees:
                trees_missing_colors = [t for t in all_trees if "leaf_color" not in t or "trunk_color" not in t]
                if trees_missing_colors:
                    print(f"[VOICE] UNIVERSAL FALLBACK: {len(trees_missing_colors)} trees missing colors in {trees_source} operation, adding colors...")
                    command_lower = command.lower()
                    leaf_color = "#228B22"  # Default forest green
                    trunk_color = "#8b4513"  # Default brown
                    
                    # AUTUMN/RED/ORANGE/YELLOW COLORS (highest priority)
                    if any(word in command_lower for word in ["red", "autumn", "fall", "orange", "crimson", "scarlet"]):
                        if "red" in command_lower or "crimson" in command_lower or "scarlet" in command_lower:
                            leaf_color = "#8B0000"  # Dark red
                        elif "orange" in command_lower:
                            leaf_color = "#FF8C00"  # Dark orange
                        elif "yellow" in command_lower or "gold" in command_lower:
                            leaf_color = "#FFD700"  # Gold
                        else:
                            leaf_color = "#CD5C5C"  # Indian red (autumn red)
                    # GREEN COLORS
                    elif "green" in command_lower:
                        if "dark" in command_lower:
                            leaf_color = "#1a3d0a"  # Dark green
                        elif "bright" in command_lower or "light" in command_lower:
                            leaf_color = "#4BBB6D"  # Bright green
                        else:
                            leaf_color = "#228B22"  # Forest green
                    elif "bushy" in command_lower or "busy" in command_lower:
                        leaf_color = "#228B22"  # Forest green for bushy
                    
                    if "no white" in command_lower or "no snow" in command_lower:
                        if "red" not in command_lower and "autumn" not in command_lower:
                            leaf_color = "#228B22"  # Solid green, no white parts
                    
                    # Trunk color detection
                    if "gray" in command_lower or "grey" in command_lower:
                        trunk_color = "#808080"  # Gray
                    elif "dark" in command_lower and "brown" in command_lower:
                        trunk_color = "#654321"  # Dark brown
                    elif "brown" in command_lower:
                        trunk_color = "#8b4513"  # Saddle brown
                    
                    # Add colors to ALL trees missing them
                    for tree in all_trees:
                        if "leaf_color" not in tree:
                            tree["leaf_color"] = leaf_color
                        if "trunk_color" not in tree:
                            tree["trunk_color"] = trunk_color
                    
                    print(f"[VOICE] ✓ UNIVERSAL FALLBACK: Added colors to all {len(all_trees)} trees: leaf_color={leaf_color}, trunk_color={trunk_color}")
                    print(f"[VOICE] Sample tree after universal fallback: {json.dumps(all_trees[0], indent=2)}")
        
        # Debug: Check if trees have color parameters
        if diff.get("set", {}).get("trees"):
            trees_list = diff["set"]["trees"]
            trees_with_colors = [t for t in trees_list if "leaf_color" in t or "trunk_color" in t]
            print(f"[VOICE] SET operation: Found {len(trees_with_colors)} trees with color parameters out of {len(trees_list)} total")
            if trees_with_colors:
                print(f"[VOICE] Sample tree with colors: {json.dumps(trees_with_colors[0], indent=2)}")
            else:
                print(f"[VOICE] WARNING: No color parameters found in set trees! Sample tree: {json.dumps(trees_list[0] if trees_list else {}, indent=2)}")
                # FALLBACK: If image was provided but AI didn't add colors, extract from command and add them
                if image_data and trees_list:
                    print(f"[VOICE] FALLBACK: AI didn't add colors, extracting from command text...")
                    # Extract color hints from command
                    command_lower = command.lower()
                    leaf_color = "#228B22"  # Default forest green
                    trunk_color = "#8b4513"  # Default brown
                    
                    # AUTUMN/RED/ORANGE/YELLOW COLORS (highest priority)
                    if any(word in command_lower for word in ["red", "autumn", "fall", "orange", "crimson", "scarlet"]):
                        if "red" in command_lower or "crimson" in command_lower or "scarlet" in command_lower:
                            leaf_color = "#8B0000"  # Dark red
                        elif "orange" in command_lower:
                            leaf_color = "#FF8C00"  # Dark orange
                        elif "yellow" in command_lower or "gold" in command_lower:
                            leaf_color = "#FFD700"  # Gold
                        else:
                            # Generic autumn - use red-orange
                            leaf_color = "#CD5C5C"  # Indian red (autumn red)
                    # GREEN COLORS
                    elif "green" in command_lower:
                        if "dark" in command_lower:
                            leaf_color = "#1a3d0a"  # Dark green
                        elif "bright" in command_lower or "light" in command_lower:
                            leaf_color = "#4BBB6D"  # Bright green
                        else:
                            leaf_color = "#228B22"  # Forest green
                    # BUSHY/BUSY (typo handling)
                    elif "bushy" in command_lower or "busy" in command_lower:
                        leaf_color = "#228B22"  # Forest green for bushy
                    
                    # Check for "no white" or "no snow" - means fully green
                    if "no white" in command_lower or "no snow" in command_lower and "red" not in command_lower and "autumn" not in command_lower:
                        leaf_color = "#228B22"  # Solid green, no white parts
                    
                    # Trunk color detection
                    if "gray" in command_lower or "grey" in command_lower:
                        trunk_color = "#808080"  # Gray
                    elif "dark" in command_lower and "brown" in command_lower:
                        trunk_color = "#654321"  # Dark brown
                    elif "brown" in command_lower:
                        trunk_color = "#8b4513"  # Saddle brown
                    
                    # Add colors to ALL trees
                    for tree in trees_list:
                        if "leaf_color" not in tree:
                            tree["leaf_color"] = leaf_color
                        if "trunk_color" not in tree:
                            tree["trunk_color"] = trunk_color
                    print(f"[VOICE] ✓ Added fallback colors to {len(trees_list)} trees: leaf_color={leaf_color}, trunk_color={trunk_color}")
                    print(f"[VOICE] Sample tree after fallback: {json.dumps(trees_list[0], indent=2)}")
        
        if diff.get("add", {}).get("trees"):
            trees_list = diff["add"]["trees"]
            trees_with_colors = [t for t in trees_list if "leaf_color" in t or "trunk_color" in t]
            print(f"[VOICE] ADD operation: Found {len(trees_with_colors)} new trees with color parameters out of {len(trees_list)} total")
            # FALLBACK: If image provided but no colors in added trees
            if image_data and trees_list and len(trees_with_colors) == 0:
                print(f"[VOICE] FALLBACK: Adding colors to new trees based on command...")
                command_lower = command.lower()
                leaf_color = "#228B22"  # Default forest green
                trunk_color = "#8b4513"  # Default brown
                
                # AUTUMN/RED/ORANGE/YELLOW COLORS (highest priority)
                if any(word in command_lower for word in ["red", "autumn", "fall", "orange", "crimson", "scarlet"]):
                    if "red" in command_lower or "crimson" in command_lower or "scarlet" in command_lower:
                        leaf_color = "#8B0000"  # Dark red
                    elif "orange" in command_lower:
                        leaf_color = "#FF8C00"  # Dark orange
                    elif "yellow" in command_lower or "gold" in command_lower:
                        leaf_color = "#FFD700"  # Gold
                    else:
                        leaf_color = "#CD5C5C"  # Indian red (autumn red)
                # GREEN COLORS
                elif "green" in command_lower:
                    if "dark" in command_lower:
                        leaf_color = "#1a3d0a"
                    elif "bright" in command_lower or "light" in command_lower:
                        leaf_color = "#4BBB6D"
                    else:
                        leaf_color = "#228B22"
                elif "bushy" in command_lower or "busy" in command_lower:
                    leaf_color = "#228B22"
                
                if "no white" in command_lower or "no snow" in command_lower and "red" not in command_lower and "autumn" not in command_lower:
                    leaf_color = "#228B22"
                
                # Trunk color detection
                if "gray" in command_lower or "grey" in command_lower:
                    trunk_color = "#808080"
                elif "dark" in command_lower and "brown" in command_lower:
                    trunk_color = "#654321"
                elif "brown" in command_lower:
                    trunk_color = "#8b4513"
                
                for tree in trees_list:
                    if "leaf_color" not in tree:
                        tree["leaf_color"] = leaf_color
                    if "trunk_color" not in tree:
                        tree["trunk_color"] = trunk_color
                print(f"[VOICE] ✓ Added fallback colors to {len(trees_list)} new trees: leaf_color={leaf_color}, trunk_color={trunk_color}")
        
        # Log the entire diff structure for debugging (truncated if too long)
        diff_str = json.dumps(diff, indent=2)
        if len(diff_str) > 2000:
            print(f"[VOICE] Full diff structure (truncated): {diff_str[:2000]}...")
        else:
            print(f"[VOICE] Full diff structure: {diff_str}")
        
        # Validate removals - check if AI is removing more than requested
        remove_ops = diff.get("remove", {})
        if remove_ops:
            # Check if command contains "all" and validate removals match
            command_lower = command.lower()
            if "remove all" in command_lower or "delete all" in command_lower:
                # Extract the structure type from command
                structure_types_in_command = []
                for struct_type in ["trees", "houses", "skyscrapers", "buildings", "rocks", "peaks", "street_lamps", "enemies"]:
                    if struct_type in command_lower:
                        structure_types_in_command.append(struct_type)
                
                # Warn if AI is removing types not mentioned in command
                for removed_type in remove_ops.keys():
                    if removed_type not in structure_types_in_command and remove_ops[removed_type] > 0:
                        print(f"[WARNING] AI is removing {removed_type} but command only mentioned: {structure_types_in_command}")
                        # Don't remove it, just log warning - let the AI's decision stand for now
        
        # Handle building additions - generate actual building objects
        if diff.get("add", {}).get("buildings"):
            count = diff["add"]["buildings"]
            if isinstance(count, int):
                existing_buildings = current_world.get("structures", {}).get("buildings", [])
                new_buildings = generate_new_buildings(count, current_biome, existing_buildings)
                diff["add"]["buildings"] = new_buildings
                print(f"[VOICE] Converted building count {count} to {len(new_buildings)} objects")
        
        # Handle street lamp additions - generate actual street lamp objects if count provided
        if diff.get("add", {}).get("street_lamps"):
            items = diff["add"]["street_lamps"]
            if isinstance(items, int):
                existing_street_lamps = current_world.get("structures", {}).get("street_lamps", [])
                new_street_lamps = generate_new_street_lamps(items, current_biome, existing_street_lamps)
                diff["add"]["street_lamps"] = new_street_lamps
                print(f"[VOICE] Converted street lamp count {items} to {len(new_street_lamps)} objects")
        
        # Handle enemy additions - generate actual enemy objects
        if diff.get("add", {}).get("enemies"):
            count = diff["add"]["enemies"]
            if isinstance(count, int):
                existing_enemies = current_world.get("combat", {}).get("enemies", [])
                new_enemies = generate_new_enemies(count, existing_enemies)
                diff["add"]["enemies"] = new_enemies
                print(f"[VOICE] Converted enemy count {count} to {len(new_enemies)} objects")
        
        # Automatically detect and remove blocking structures
        diff = detect_and_remove_blocking_structures(diff, current_world)
        
        if diff.get("time_change"):
            if from_time and to_time and progress < 1.0:
                lighting_config = interpolate_lighting(from_time, to_time, progress, current_biome)
            else:
                lighting_config = get_lighting_preset(diff["time_change"], current_biome)
            
            diff["lighting"] = lighting_config
            
            if "world" not in diff:
                diff["world"] = {}
            diff["world"]["time"] = diff["time_change"]
        
        elif from_time and to_time:
            lighting_config = interpolate_lighting(from_time, to_time, progress, current_biome)
            diff["lighting"] = lighting_config

        return diff

    except json.JSONDecodeError:
        print("[CLAUDE INVALID JSON]", raw)
        return {
            "add": {"trees": [], "buildings": [], "peaks": [], "rocks": [], "enemies": []},
            "physics": None,
            "lighting": None,
            "combat": None,
            "message": "Failed to parse AI output"
        }
    except Exception as e:
        print("[CLAUDE ERROR]", e)
        return {
            "add": {"trees": [], "buildings": [], "peaks": [], "rocks": [], "enemies": []},
            "physics": None,
            "lighting": None,
            "combat": None,
            "message": str(e)
        }

def merge_world(current_world: Dict, diff: Dict) -> Dict:
    """
    Merge a 'diff' dictionary from the AI into the current world safely.
    Handles additions, removals, and set operations.
    Returns only changed fields to avoid unnecessary frontend updates.
    """
    # Store original values to detect changes
    original_lighting = current_world.get("world", {}).get("lighting_config")
    original_physics = current_world.get("physics", {}).copy() if current_world.get("physics") else {}
    
    current_world.setdefault("world", {})
    current_world.setdefault("structures", {})
    current_world.setdefault("combat", {})
    current_world.setdefault("physics", {})
    current_world.setdefault("spawn_point", {})

    # Merge lighting config into world
    if diff.get("lighting"):
        current_world["world"]["lighting_config"] = diff["lighting"]

    # Merge general world properties
    diff_world = diff.get("world", {})
    for key in ["biome", "time", "sky_colour", "lighting_config"]:
        if key in diff_world:
            current_world["world"][key] = diff_world[key]

    # Merge terrain
    for key in ["heightmap_raw", "heightmap_url", "texture_url", "colour_map_array"]:
        if key in diff_world:
            current_world["world"][key] = diff_world[key]

    # Handle REMOVALS (reduce counts)
    remove_ops = diff.get("remove", {})
    for struct_type, count in remove_ops.items():
        if count > 0:
            if struct_type == "enemies":
                current_enemies = current_world["combat"].get("enemies", [])
                new_count = max(0, len(current_enemies) - count)
                current_world["combat"]["enemies"] = current_enemies[:new_count]
                current_world["combat"]["enemy_count"] = new_count
                print(f"[MERGE] Removed {count} enemies, now {new_count} total")
            elif struct_type == "skyscrapers":
                # Filter buildings to remove only skyscrapers
                current_buildings = current_world["structures"].get("buildings", [])
                skyscrapers = [b for b in current_buildings if b.get("type") == "skyscraper"]
                houses = [b for b in current_buildings if b.get("type") != "skyscraper"]
                # If count is 999 or greater than current count, remove all skyscrapers
                if count >= 999 or count >= len(skyscrapers):
                    removed = len(skyscrapers)
                    remaining_skyscrapers = []
                else:
                    removed = count
                    remaining_skyscrapers = skyscrapers[removed:]
                current_world["structures"]["buildings"] = houses + remaining_skyscrapers
                print(f"[MERGE] Removed {removed} skyscrapers, {len(remaining_skyscrapers)} skyscrapers remaining")
            elif struct_type == "houses":
                # Filter buildings to remove only houses
                current_buildings = current_world["structures"].get("buildings", [])
                skyscrapers = [b for b in current_buildings if b.get("type") == "skyscraper"]
                houses = [b for b in current_buildings if b.get("type") != "skyscraper"]
                # If count is 999 or greater than current count, remove all houses
                if count >= 999 or count >= len(houses):
                    removed = len(houses)
                    remaining_houses = []
                else:
                    removed = count
                    remaining_houses = houses[removed:]
                current_world["structures"]["buildings"] = skyscrapers + remaining_houses
                print(f"[MERGE] Removed {removed} houses, {len(remaining_houses)} houses remaining")
            else:
                current_list = current_world["structures"].get(struct_type, [])
                current_count = len(current_list)
                # If count is 999 or greater than current count, remove all
                if count >= 999 or count >= current_count:
                    new_count = 0
                    removed = current_count
                else:
                    new_count = max(0, current_count - count)
                    removed = count
                current_world["structures"][struct_type] = current_list[:new_count]
                print(f"[MERGE] Removed {removed} {struct_type}, now {new_count} total")

    # Handle SET operations (set exact counts OR replace with new objects)
    set_ops = diff.get("set", {})
    for struct_type, target_value in set_ops.items():
        if target_value is not None:
            # Check if target_value is a list (array of objects) or a number (count)
            if isinstance(target_value, list):
                # Replace entire array with new objects (used for tree styling with colors)
                if struct_type == "trees":
                    current_world["structures"]["trees"] = target_value
                    print(f"[MERGE] Set trees: replaced all {len(target_value)} trees with styled versions (with colors)")
                elif struct_type == "enemies":
                    current_world["combat"]["enemies"] = target_value
                    current_world["combat"]["enemy_count"] = len(target_value)
                    print(f"[MERGE] Set enemies: replaced all with {len(target_value)} new enemies")
                else:
                    current_world["structures"][struct_type] = target_value
                    print(f"[MERGE] Set {struct_type}: replaced all with {len(target_value)} new objects")
            else:
                # It's a number - set exact count (original behavior)
                target_count = target_value
                if struct_type == "enemies":
                    current_enemies = current_world["combat"].get("enemies", [])
                    current_count = len(current_enemies)
                    if target_count < current_count:
                        current_world["combat"]["enemies"] = current_enemies[:target_count]
                        current_world["combat"]["enemy_count"] = target_count
                        print(f"[MERGE] Set enemies to {target_count} (removed {current_count - target_count})")
                elif struct_type == "skyscrapers":
                    # Set exact number of skyscrapers
                    current_buildings = current_world["structures"].get("buildings", [])
                    skyscrapers = [b for b in current_buildings if b.get("type") == "skyscraper"]
                    houses = [b for b in current_buildings if b.get("type") != "skyscraper"]
                    current_world["structures"]["buildings"] = houses + skyscrapers[:target_count]
                    print(f"[MERGE] Set skyscrapers to {target_count} (removed {max(0, len(skyscrapers) - target_count)})")
                elif struct_type == "houses":
                    # Set exact number of houses
                    current_buildings = current_world["structures"].get("buildings", [])
                    skyscrapers = [b for b in current_buildings if b.get("type") == "skyscraper"]
                    houses = [b for b in current_buildings if b.get("type") != "skyscraper"]
                    current_world["structures"]["buildings"] = skyscrapers + houses[:target_count]
                    print(f"[MERGE] Set houses to {target_count} (removed {max(0, len(houses) - target_count)})")
                else:
                    current_list = current_world["structures"].get(struct_type, [])
                    current_count = len(current_list)
                    if target_count < current_count:
                        current_world["structures"][struct_type] = current_list[:target_count]
                        print(f"[MERGE] Set {struct_type} to {target_count} (removed {current_count - target_count})")

    # Handle ADDITIONS (from "add" field)
    diff_add = diff.get("add", {})
    for struct_type, items in diff_add.items():
        if items:
            if struct_type == "enemies":
                current_world["combat"].setdefault("enemies", [])
                current_world["combat"]["enemies"].extend(items)
                current_world["combat"]["enemy_count"] = len(current_world["combat"]["enemies"])
                print(f"[MERGE] Added {len(items)} enemies, total: {current_world['combat']['enemy_count']}")
            else:
                current_world["structures"].setdefault(struct_type, [])
                current_world["structures"][struct_type].extend(items)
                print(f"[MERGE] Added {len(items)} {struct_type}")

    # Also merge from "structures" field (for initial generation)
    diff_structures = diff.get("structures", {})
    for struct_type, items in diff_structures.items():
        if items:
            current_world["structures"].setdefault(struct_type, [])
            current_world["structures"][struct_type].extend(items)

    # Merge enemies/combat (from initial generation)
    diff_combat = diff.get("combat")
    if diff_combat:
        if diff_combat.get("enemies"):
            current_world["combat"].setdefault("enemies", [])
            current_world["combat"]["enemies"].extend(diff_combat["enemies"])
        if "enemy_count" in diff_combat:
            current_world["combat"]["enemy_count"] = len(current_world["combat"]["enemies"])

    # Merge physics/player if present
    if diff.get("physics"):
        current_world["physics"].update(diff["physics"] or {})

    # Merge spawn point if provided
    if diff.get("spawn_point"):
        current_world["spawn_point"].update(diff["spawn_point"])

    # FINAL SAFETY CHECK: If image was in the original request, ensure all trees have colors
    # (This handles cases where colors might have been lost during merge)
    # Note: We can't access the original command/image_data here, but we can check if trees have colors
    # and if they don't, it means the fallback didn't run or colors were lost
    
    # Build response with only changed fields to optimize frontend updates
    # Always include structures and combat as they may have changed
    response = {
        "structures": current_world["structures"],
        "combat": current_world["combat"]
    }
    
    # Log if trees are missing colors (for debugging)
    if response["structures"].get("trees"):
        trees_with_colors = [t for t in response["structures"]["trees"] if "leaf_color" in t and "trunk_color" in t]
        if len(trees_with_colors) < len(response["structures"]["trees"]):
            print(f"[MERGE] WARNING: {len(response['structures']['trees']) - len(trees_with_colors)} trees missing colors in final response!")
            print(f"[MERGE] This should not happen if fallback ran correctly. Check backend logs above.")
    
    # Only include world.lighting_config if lighting was actually changed
    lighting_changed = diff.get("lighting") is not None
    world_props_changed = bool(diff.get("world", {}))
    
    if lighting_changed or world_props_changed:
        # Include full world object if any world properties changed
        response["world"] = current_world["world"]
    # If lighting wasn't changed, don't include lighting_config in response
    # (frontend checks if data.world?.lighting_config exists before updating)
    
    # Only include physics if it was actually changed in the diff
    if diff.get("physics") is not None:
        new_physics = current_world.get("physics", {})
        # Only include if values actually changed from original
        if new_physics != original_physics:
            response["physics"] = new_physics
    
    # Only include spawn_point if it was changed
    if diff.get("spawn_point"):
        response["spawn_point"] = current_world["spawn_point"]
    
    return response