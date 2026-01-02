# voice.py
from typing import Dict, Optional
import sounddevice as sd
import numpy as np
import queue
from world.prompt_parser import extract_mechanic_from_command
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
