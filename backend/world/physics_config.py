
from typing import Dict
from .weapon_config import get_combat_config

DEFAULT_PHYSICS = {
    "player": {
        "speed": 5.0,
        "jump_height": 3.0,
        "gravity": 30.0,
        "acceleration": 20.0,
    },
    "mechanic": {
        "type": "both",  # default mechanic type
        "dash_speed": 10.0,
        "dash_duration": 0.3,
        "dash_cooldown": 2.0
    }
}

PHYSICS_LIMITS = {
    "speed": (2.0, 12.0),
    "jump_height": (1.0, 8.0),
    "gravity": (-40.0, -10.0),
    "dash_speed": (6.0, 20.0)
}

def clamp(value: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, value))

def get_physics_config(mechanic: str = "both") -> Dict:
    """
    Returns a physics config for the given mechanic type.
    """
    if mechanic not in ["dash", "double_jump", "both"]:
        mechanic = "both"

    config = {
        "player": DEFAULT_PHYSICS["player"].copy(),
        "mechanic": DEFAULT_PHYSICS["mechanic"].copy()
    }
    config["mechanic"]["type"] = mechanic
    return config


def get_combined_config(mechanic: str = "both") -> Dict:
    """
    Returns combined physics + combat config.
    Defaults to 'both' if mechanic is unknown or missing.
    """
    # Ensure mechanic is valid
    if mechanic not in ["dash", "double_jump", "both"]:
        effective_mechanic = "both"
    else:
        effective_mechanic = mechanic

    # Physics config
    physics = get_physics_config(effective_mechanic)

    # Combat config
    combat = get_combat_config(effective_mechanic)

    # Sync dash properties if dash exists
    if effective_mechanic in ["dash", "both"]:
        combat["dash_speed"] = physics["mechanic"]["dash_speed"]
        combat["dash_duration"] = physics["mechanic"]["dash_duration"]

    return {
        "physics": physics,
        "combat": combat
    }


def modify_physics(current_config: Dict, command: str) -> Dict:
    """Modify physics based on voice command"""
    command_lower = command.lower()
    new_config = {
        "player": current_config["player"].copy(),
        "mechanic": current_config["mechanic"].copy()
    }
    
    # Speed modifications
    if any(word in command_lower for word in ["faster", "speed up"]):
        new_config["player"]["speed"] += 1.5
    elif any(word in command_lower for word in ["slower", "slow down"]):
        new_config["player"]["speed"] -= 1.5
    
    # Jump modifications
    if any(word in command_lower for word in ["higher jump", "jump higher"]):
        new_config["player"]["jump_height"] += 0.8
    elif any(word in command_lower for word in ["lower jump", "jump lower"]):
        new_config["player"]["jump_height"] -= 0.8
    
    # Gravity modifications
    if any(word in command_lower for word in ["less gravity", "lighter"]):
        new_config["player"]["gravity"] += 5.0
    elif any(word in command_lower for word in ["more gravity", "heavier"]):
        new_config["player"]["gravity"] -= 5.0
    
    # Apply limits
    new_config["player"]["speed"] = clamp(
        new_config["player"]["speed"],
        PHYSICS_LIMITS["speed"][0],
        PHYSICS_LIMITS["speed"][1]
    )
    new_config["player"]["jump_height"] = clamp(
        new_config["player"]["jump_height"],
        PHYSICS_LIMITS["jump_height"][0],
        PHYSICS_LIMITS["jump_height"][1]
    )
    new_config["player"]["gravity"] = clamp(
        new_config["player"]["gravity"],
        PHYSICS_LIMITS["gravity"][0],
        PHYSICS_LIMITS["gravity"][1]
    )
    
    return new_config