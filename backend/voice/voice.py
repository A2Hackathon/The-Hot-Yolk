# voice.py
from typing import Dict, Optional
import sounddevice as sd
import numpy as np
import queue
import json
import os
from world.lighting import get_lighting_preset, interpolate_lighting  
from openai import OpenAI  # Claude Opus4.1 uses the OpenAI-compatible API

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



def handle_live_command(
    command: str,
    current_world: Optional[Dict] = None,
    from_time: Optional[str] = None,      # ✅ Add these params
    to_time: Optional[str] = None,         # ✅
    progress: Optional[float] = 1.0        # ✅
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
  "add": {"trees": [], "buildings": [], "peaks": []},
  "physics": null,
  "lighting": null,
  "combat": null,
  "message": null,
  "time_change": null
}
- Always update fields if applicable, leave null if unchanged.
- Use approximate counts if exact numbers are unknown.
- Positions for objects are within -120 to 120.
- Only use info from provided summary; do NOT assume unknown objects exist.
- If the player requests a time change (e.g., "make it sunset", "change to night"), 
  set "time_change" to the target time: "noon", "sunset", or "night".
- If nothing changes, set message: "No modifications applied".
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
        # ✅ Strip markdown code fences
        if raw.startswith("```json"):
            raw = raw[7:]  # Remove ```json
        if raw.startswith("```"):
            raw = raw[3:]  # Remove ```
        if raw.endswith("```"):
            raw = raw[:-3]  # Remove trailing ```
        raw = raw.strip()
        
        print(f"[CLAUDE DEBUG] Cleaned JSON: {raw}")
        
        diff = json.loads(raw)
        
        if diff.get("time_change"):
            # If from_time and to_time are provided, use smooth interpolation
            if from_time and to_time and progress < 1.0:
                lighting_config = interpolate_lighting(from_time, to_time, progress, current_biome)
            else:
                # Instant lighting change
                lighting_config = get_lighting_preset(diff["time_change"], current_biome)
            
            diff["lighting"] = lighting_config
            
            # Update world time
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
            "add": {"trees": [], "buildings": [], "peaks": []},
            "physics": None,
            "lighting": None,
            "combat": None,
            "message": "Failed to parse AI output"
        }
    except Exception as e:
        print("[CLAUDE ERROR]", e)
        return {
            "add": {"trees": [], "buildings": [], "peaks": []},
            "physics": None,
            "lighting": None,
            "combat": None,
            "message": str(e)
        }

def merge_world(current_world: Dict, diff: Dict) -> Dict:
    """
    Merge a 'diff' dictionary from the AI into the current world safely.
    """
    current_world.setdefault("world", {})
    current_world.setdefault("structures", {})
    current_world.setdefault("combat", {})
    current_world.setdefault("physics", {})
    current_world.setdefault("spawn_point", {})

    # Merge lighting config into world
    if diff.get("lighting"):
        current_world["world"]["lighting_config"] = diff["lighting"]

    # Merge general world properties - CHECK IF "world" EXISTS FIRST
    diff_world = diff.get("world", {})  # Get "world" or empty dict
    for key in ["biome", "time", "sky_colour", "lighting_config"]:
        if key in diff_world:
            current_world["world"][key] = diff_world[key]

    # Merge terrain - CHECK IF "world" EXISTS FIRST
    for key in ["heightmap_raw", "heightmap_url", "texture_url", "colour_map_array"]:
        if key in diff_world:
            current_world["world"][key] = diff_world[key]

    # Merge structures from "add" field (for modifications)
    diff_add = diff.get("add", {})  # Get "add" or empty dict
    for struct_type, items in diff_add.items():
        if items:  # Only if there are items to add
            current_world["structures"].setdefault(struct_type, [])
            current_world["structures"][struct_type].extend(items)

    # Also merge from "structures" field (for initial generation)
    diff_structures = diff.get("structures", {})  # Get "structures" or empty dict
    for struct_type, items in diff_structures.items():
        if items:
            current_world["structures"].setdefault(struct_type, [])
            current_world["structures"][struct_type].extend(items)

    # Merge enemies/combat
    diff_combat = diff.get("combat")
    if diff_combat:  # Only process if combat is not None
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