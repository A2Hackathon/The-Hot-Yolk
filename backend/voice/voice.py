# voice.py
from typing import Dict, Optional
import sounddevice as sd
import numpy as np
import queue
import re
import speech_recognition as sr
from world.prompt_parser import parse_prompt, extract_mechanic_from_command
from world.physics_config import get_combined_config, modify_physics
from world.lighting import get_lighting_preset, interpolate_lighting

# Create a queue to hold audio chunks
audio_queue = queue.Queue()

def record_audio(duration: float = 5.0, fs: int = 44100) -> np.ndarray:
    """
    Record audio from the microphone using sounddevice
    """
    print("[Voice] Recording audio...")
    recording = sd.rec(int(duration * fs), samplerate=fs, channels=1, dtype='int16')
    sd.wait()
    print("[Voice] Recording finished")
    return recording.flatten()

def parse_prompt(prompt_text: str) -> dict:
    """
    Convert a raw prompt string into structured parameters for world generation.
    Returns a dict with keys: biome, time, enemy_count, weapon, structure
    """
    prompt_text = prompt_text.lower()
    
    # Default values
    result = {
        "biome": "city",
        "time": "noon",
        "enemy_count": 5,
        "weapon": "dash",
        "structure": {}
    }

    # --- Biome detection ---
    if "icy" in prompt_text or "snow" in prompt_text:
        result["biome"] = "icy"
    elif "desert" in prompt_text:
        result["biome"] = "desert"
    elif "forest" in prompt_text:
        result["biome"] = "forest"
    elif "city" in prompt_text:
        result["biome"] = "city"

    # --- Time of day ---
    if "sunset" in prompt_text:
        result["time"] = "sunset"
    elif "night" in prompt_text:
        result["time"] = "night"
    elif "dawn" in prompt_text or "morning" in prompt_text:
        result["time"] = "dawn"
    elif "noon" in prompt_text:
        result["time"] = "noon"

    # --- Enemy count ---
    match = re.search(r'(\d+)\s*enemies?', prompt_text)
    if match:
        result["enemy_count"] = int(match.group(1))

    # --- Weapon / mechanic ---
    if "dash" in prompt_text:
        result["weapon"] = "dash"
    elif "double jump" in prompt_text:
        result["weapon"] = "double_jump"
    elif "teleport" in prompt_text:
        result["weapon"] = "teleport"

    # --- Structures (optional, simple example) ---
    structures = {}
    for struct in ["tower", "castle", "house", "bridge"]:
        match = re.search(r'(\d+)\s+' + struct + 's?', prompt_text)
        if match:
            structures[struct] = int(match.group(1))
    result["structure"] = structures

    return result

def handle_live_command(
        command: str,
        current_physics: Optional[Dict] = None,
        from_time: Optional[str] = None,
        to_time: Optional[str] = None,
        progress: float = 1.0
    ) -> Dict:
    """
    Execute a live voice command.
    Can modify:
    - Combat mechanic
    - Lighting (instant or interpolated)
    - Physics parameters
    """
    response = {}
    cmd_lower = command.lower()

    # --- Combat mechanic change ---
    new_mechanic = extract_mechanic_from_command(cmd_lower)
    if new_mechanic:  # update stats
        configs = get_combined_config(new_mechanic)
        response['combat'] = configs['combat']
        response['physics'] = configs['physics']

    # --- Handle lighting changes ---
    if from_time and to_time:
        progress_clamped = max(0.0, min(1.0, progress))
        interpolated_lighting = interpolate_lighting(
            from_time=from_time,
            to_time=to_time,
            progress=progress_clamped
        )
        response['lighting'] = interpolated_lighting
    else:
        if any(word in cmd_lower for word in ["night", "dark", "darker"]):
            response['lighting'] = get_lighting_preset("night")
        elif any(word in cmd_lower for word in ["sunset", "dusk", "evening"]):
            response['lighting'] = get_lighting_preset("sunset")
        elif any(word in cmd_lower for word in ["day", "noon", "bright", "lighter"]):
            response['lighting'] = get_lighting_preset("noon")

    # --- Physics modifications ---
    if current_physics and any(word in cmd_lower for word in [
        "faster", "slower", "jump", "gravity", "speed"
    ]):
        modified_physics = modify_physics(current_physics, cmd_lower)
        response['physics'] = modified_physics

    if not response:
        response['message'] = "No modifications applied"
        response['command'] = command

    return response
