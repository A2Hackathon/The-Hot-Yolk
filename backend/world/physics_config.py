
from typing import Dict

DEFAULT_PHYSICS = {
    "player": {
        "speed": 5.0,
        "jump_height": 3.0,
        "gravity": -20.0,
        "acceleration": 20.0,
    },
    "mechanic": {
        "type": "double_jump",
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

def get_physics_config(mechanic: str = "double_jump") -> Dict:
    """
    Get physics configuration for given mechanic
    
    Args:
        mechanic: "double_jump", "dash", or "none"
    
    Returns:
        Physics config dict
    """
    config = {
        "player": DEFAULT_PHYSICS["player"].copy(),
        "mechanic": DEFAULT_PHYSICS["mechanic"].copy()
    }
    
    # Set mechanic type
    if mechanic in ["double_jump", "dash", "none"]:
        config["mechanic"]["type"] = mechanic
    else:
        config["mechanic"]["type"] = "double_jump"
    
    # If no combat, disable dash
    if mechanic == "none":
        config["mechanic"]["dash_speed"] = 0
        config["mechanic"]["dash_duration"] = 0
    
    return config

def get_combined_config(mechanic: str) -> Dict:
    """
    Get both physics and combat config together
    Ensures dash properties are consistent
    
    Args:
        mechanic: "double_jump", "dash", or "none"
    
    Returns:
        Combined dict with physics and combat
    """
    from .weapon_config import get_combat_config
    
    physics = get_physics_config(mechanic)
    combat = get_combat_config(mechanic)
    
    # Sync dash properties from physics to combat
    if mechanic == "dash":
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