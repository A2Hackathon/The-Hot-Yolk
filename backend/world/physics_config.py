from typing import Dict, Optional
import re

DEFAULT_PHYSICS = {
    "player": {
        "speed": 5.0,           # Units per second
        "jump_height": 3.0,     # Units
        "gravity": -20.0,       # Units per second² (negative = downward)
        "acceleration": 20.0,   # How fast to reach max speed
    },
    "mechanic": {
        "type": "double_jump",  # "double_jump" or "dash"
        "dash_speed": 10.0,     # Speed during dash
        "dash_duration": 0.3,   # Seconds
        "dash_cooldown": 2.0    # Seconds between dashes
    }
}

# Min/max limits to prevent breaking the game
PHYSICS_LIMITS = {
    "speed": (2.0, 12.0),
    "jump_height": (1.0, 8.0),
    "gravity": (-40.0, -10.0),  # More negative = stronger gravity
    "dash_speed": (6.0, 20.0)
}

def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp value between min and max"""
    return max(min_val, min(max_val, value))

def get_physics_config(mechanic: str = "double_jump") -> Dict:
    """
    Get default physics configuration
    
    Args:
        mechanic: "double_jump" or "dash"
    
    Returns:
        Physics config dict
    """
    config = DEFAULT_PHYSICS.copy()
    config["mechanic"]["type"] = mechanic if mechanic in ["double_jump", "dash"] else "double_jump"
    
    return config

def modify_physics(current_config: Dict, command: str) -> Dict:
    """
    Modify physics based on voice command
    Supports commands like:
    - "make me faster"
    - "higher jumps"
    - "less gravity"
    - "slower movement"
    
    Args:
        current_config: Current physics config
        command: Natural language command
    
    Returns:
        Updated physics config
    """
    command_lower = command.lower()
    
    # Create a copy to modify
    new_config = {
        "player": current_config["player"].copy(),
        "mechanic": current_config["mechanic"].copy()
    }
    
    # Speed modifications
    if any(word in command_lower for word in ["faster", "speed up", "quicker"]):
        new_config["player"]["speed"] += 1.5
        print(f"[Physics] Increased speed to {new_config['player']['speed']}")
    
    elif any(word in command_lower for word in ["slower", "slow down"]):
        new_config["player"]["speed"] -= 1.5
        print(f"[Physics] Decreased speed to {new_config['player']['speed']}")
    
    # Jump modifications
    if any(word in command_lower for word in ["higher jump", "jump higher", "more jump"]):
        new_config["player"]["jump_height"] += 0.8
        print(f"[Physics] Increased jump height to {new_config['player']['jump_height']}")
    
    elif any(word in command_lower for word in ["lower jump", "jump lower", "less jump"]):
        new_config["player"]["jump_height"] -= 0.8
        print(f"[Physics] Decreased jump height to {new_config['player']['jump_height']}")
    
    # Gravity modifications
    if any(word in command_lower for word in ["less gravity", "lower gravity", "floaty", "lighter"]):
        new_config["player"]["gravity"] += 5.0  # Less negative = weaker gravity
        print(f"[Physics] Decreased gravity to {new_config['player']['gravity']}")
    
    elif any(word in command_lower for word in ["more gravity", "higher gravity", "heavier"]):
        new_config["player"]["gravity"] -= 5.0  # More negative = stronger gravity
        print(f"[Physics] Increased gravity to {new_config['player']['gravity']}")
    
    # Mechanic switch
    if "dash" in command_lower and "double jump" not in command_lower:
        new_config["mechanic"]["type"] = "dash"
        print(f"[Physics] Switched to dash mechanic")
    
    elif "double jump" in command_lower:
        new_config["mechanic"]["type"] = "double_jump"
        print(f"[Physics] Switched to double jump mechanic")
    
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

def get_biome_physics(biome: str, base_config: Optional[Dict] = None) -> Dict:
    """
    Optional: Adjust physics based on biome
    Arctic = slippery, City = normal
    
    Args:
        biome: "arctic" or "city"
        base_config: Base physics config (uses default if None)
    
    Returns:
        Biome-adjusted physics config
    """
    if base_config is None:
        config = get_physics_config()
    else:
        config = {
            "player": base_config["player"].copy(),
            "mechanic": base_config["mechanic"].copy()
        }
    
    if biome == "arctic":
        # Slightly slippery on ice
        config["player"]["acceleration"] = 15.0  # Slower acceleration
        config["player"]["speed"] *= 0.9  # Slightly slower
        print(f"[Physics] Applied arctic biome adjustments (slippery)")
    
    elif biome == "city":
        # Normal traction
        config["player"]["acceleration"] = 20.0
        print(f"[Physics] Applied city biome adjustments (normal)")
    
    return config

def reset_physics() -> Dict:
    """Reset to default physics"""
    print(f"[Physics] Reset to default values")
    return get_physics_config()


# Example usage
if __name__ == "__main__":
    import json
    
    print("=== Default Physics Config ===")
    default = get_physics_config()
    print(json.dumps(default, indent=2))
    
    print("\n=== Testing Voice Commands ===")
    
    # Test speed increase
    config = get_physics_config()
    config = modify_physics(config, "make me faster")
    print(f"Speed after 'faster': {config['player']['speed']}")
    
    # Test jump increase
    config = modify_physics(config, "higher jumps")
    print(f"Jump after 'higher': {config['player']['jump_height']}")
    
    # Test gravity decrease
    config = modify_physics(config, "less gravity")
    print(f"Gravity after 'less gravity': {config['player']['gravity']}")
    
    # Test mechanic switch
    config = modify_physics(config, "switch to dash")
    print(f"Mechanic: {config['mechanic']['type']}")
    
    print("\n=== Testing Limits ===")
    # Try to break limits
    config = get_physics_config()
    for i in range(10):
        config = modify_physics(config, "make me faster")
    print(f"Speed after 10x 'faster': {config['player']['speed']} (clamped to {PHYSICS_LIMITS['speed'][1]})")
    
    print("\n=== Biome Physics ===")
    arctic = get_biome_physics("arctic")
    print(f"Arctic acceleration: {arctic['player']['acceleration']}")
    print(f"Arctic speed: {arctic['player']['speed']:.2f}")
    
    city = get_biome_physics("city")
    print(f"City acceleration: {city['player']['acceleration']}")
    print(f"City speed: {city['player']['speed']:.2f}")