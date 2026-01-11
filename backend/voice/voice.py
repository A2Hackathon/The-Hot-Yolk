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

    return {
        "biome": world.get("world", {}).get("biome"),
        "time": world.get("world", {}).get("time"),
        "sky_colour": world.get("world", {}).get("sky_colour"),
        "structures": {k: len(v) for k, v in world.get("structures", {}).items()},
        "combat": {
            "enemy_count": world.get("combat", {}).get("enemy_count", 0)
        }
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
    from_time: Optional[str] = None,
    to_time: Optional[str] = None,
    progress: Optional[float] = 1.0
) -> Dict:
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
  "add": {"trees": [], "buildings": [], "peaks": [], "rocks": [], "enemies": []},
  "remove": {"trees": 0, "buildings": 0, "peaks": 0, "rocks": 0, "enemies": 0},
  "set": {"trees": null, "buildings": null, "peaks": null, "rocks": null, "enemies": null},
  "physics": null,
  "lighting": null,
  "combat": null,
  "message": null,
  "time_change": null
}

MODIFICATION TYPES:
1. ADD: Use "add" field with count only (number) for buildings and enemies
   - "add 5 trees" → {"add": {"trees": [5 tree objects]}}
   - "add 3 buildings" → {"add": {"buildings": 3}}  // Just the count!
   - "add 4 enemies" → {"add": {"enemies": 4}}      // Just the count!
   
2. REMOVE: Use "remove" to delete structures
   - "remove 3 buildings" → {"remove": {"buildings": 3}}
   - "remove all trees" → {"remove": {"trees": 999}}
   - "delete 2 enemies" → {"remove": {"enemies": 2}}
   
3. SET: Use "set" to change total count
   - "set trees to 10" → {"set": {"trees": 10}}
   - "I want exactly 5 buildings" → {"set": {"buildings": 5}}

IMPORTANT FOR BUILDINGS AND ENEMIES:
- For "add buildings" or "add enemies", return ONLY THE COUNT as a number
- Backend will generate positions and full objects
- Example: {"add": {"buildings": 5}} NOT {"add": {"buildings": [...]}}

IMPORTANT FOR OTHER STRUCTURES (trees, rocks, peaks):
- For trees/rocks/peaks, you must generate full objects with positions
- Example: {"add": {"trees": [{"type": "oak", "position": {...}, ...}]}}

4. CLEAR: Use remove with high number
   - "remove all buildings" → {"remove": {"buildings": 999}}
   - "clear enemies" → {"remove": {"enemies": 999}}

TREE/ROCK/PEAK GENERATION:
- Trees need: type, leafless, position {x, y, z}, scale, rotation
- Rocks need: type, position {x, y, z}, scale, rotation
- Peaks need: type, position {x, y, z}, scale

BUILDING/ENEMY GENERATION:
- Just return count as number, backend handles generation
- Example: "add 5 buildings" → {"add": {"buildings": 5}}
- Example: "add 3 enemies" → {"add": {"enemies": 3}}
"""

    user_prompt = f"""
World summary:
{json.dumps(world_summary)}

Player command:
"{command}"
"""

    try:
        response = claude_client.chat.completions.create(
            model="anthropic/claude-opus-4",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=4000,
            temperature=0.2
        )
        raw = response.choices[0].message.content.strip()
        # Strip markdown code fences
        if raw.startswith("```json"):
            raw = raw[7:]
        if raw.startswith("```"):
            raw = raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3]
        raw = raw.strip()
        
        print(f"[CLAUDE DEBUG] Cleaned JSON: {raw}")
        
        diff = json.loads(raw)
        
        # Handle building additions - generate actual building objects
        if diff.get("add", {}).get("buildings"):
            count = diff["add"]["buildings"]
            if isinstance(count, int):
                existing_buildings = current_world.get("structures", {}).get("buildings", [])
                new_buildings = generate_new_buildings(count, current_biome, existing_buildings)
                diff["add"]["buildings"] = new_buildings
                print(f"[VOICE] Converted building count {count} to {len(new_buildings)} objects")
        
        # Handle enemy additions - generate actual enemy objects
        if diff.get("add", {}).get("enemies"):
            count = diff["add"]["enemies"]
            if isinstance(count, int):
                existing_enemies = current_world.get("combat", {}).get("enemies", [])
                new_enemies = generate_new_enemies(count, existing_enemies)
                diff["add"]["enemies"] = new_enemies
                print(f"[VOICE] Converted enemy count {count} to {len(new_enemies)} objects")
        
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
    """
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
            else:
                current_list = current_world["structures"].get(struct_type, [])
                new_count = max(0, len(current_list) - count)
                current_world["structures"][struct_type] = current_list[:new_count]
                print(f"[MERGE] Removed {count} {struct_type}, now {new_count} total")

    # Handle SET operations (set exact counts)
    set_ops = diff.get("set", {})
    for struct_type, target_count in set_ops.items():
        if target_count is not None:
            if struct_type == "enemies":
                current_enemies = current_world["combat"].get("enemies", [])
                current_count = len(current_enemies)
                if target_count < current_count:
                    current_world["combat"]["enemies"] = current_enemies[:target_count]
                    current_world["combat"]["enemy_count"] = target_count
                    print(f"[MERGE] Set enemies to {target_count} (removed {current_count - target_count})")
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

    return current_world