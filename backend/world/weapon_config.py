from typing import Dict

# Combat mechanics config
COMBAT_CONFIGS = {
    "none": {
        # Pure platformer mode - no combat at all
        "can_attack": False,
        "jump_damage": 0,
        "dash_damage": 0,
        "description": "No combat - pure platformer/dodge gameplay"
    },
    
    "jump_only": {
        # Mario-style stomp mechanic
        "can_attack": True,
        "jump_damage": 30.0,        # Damage when landing on enemy
        "jump_hit_radius": 1.0,     # How close to enemy head to register hit
        "jump_bounce_height": 2.0,  # Bounce up after successful stomp
        "dash_damage": 0,
        "description": "Jump on enemies to defeat them"
    },
    
    "dash_only": {
        # Celeste-style dash attack
        "can_attack": True,
        "jump_damage": 0,
        "dash_damage": 25.0,         # Damage when dashing through enemy
        "dash_hit_radius": 1.2,      # Collision detection during dash
        "dash_invulnerability": 0.3, # Seconds of invincibility during dash
        "description": "Dash through enemies to defeat them"
    },
    
    "both": {
        # Both mechanics enabled
        "can_attack": True,
        "jump_damage": 30.0,
        "jump_hit_radius": 1.0,
        "jump_bounce_height": 2.0,
        "dash_damage": 25.0,
        "dash_hit_radius": 1.2,
        "dash_invulnerability": 0.3,
        "description": "Jump on or dash through enemies"
    }
}

# Enemy stats (health, speed, etc.)
ENEMY_STATS = {
    "sentinel": {
        "health": 30.0,           # Dies in 1 stomp or 2 dashes (if dash does 25)
        "damage": 10.0,           # Damage to player on contact
        "speed": 2.5,             # Units per second
        "detection_radius": 15.0, # How far they can see player
        "attack_radius": 1.5      # How close to deal damage
    }
}

def get_combat_config(mechanic: str) -> Dict:
    """
    Get combat configuration based on player mechanic
    
    Args:
        mechanic: "double_jump" or "dash"
    
    Returns:
        Combat config dict
    """
    mech = mechanic.lower()
    
    if mech == "double_jump":
        # Double jump = better at stomping enemies
        return COMBAT_CONFIGS["jump_only"].copy()
    
    elif mech == "dash":
        # Dash = attack by dashing through enemies
        return COMBAT_CONFIGS["dash_only"].copy()
    
    else:
        # Default to both 
        return COMBAT_CONFIGS["both"].copy()

def get_enemy_stats(enemy_type: str = "sentinel") -> Dict:
    return ENEMY_STATS.get(enemy_type, ENEMY_STATS["sentinel"]).copy()

def check_jump_attack(player_y: float, player_y_velocity: float, 
                     enemy_y: float, distance_xz: float, config: Dict) -> bool:
    if not config.get("can_attack", False):
        return False
    
    jump_damage = config.get("jump_damage", 0)
    if jump_damage <= 0:
        return False
    
    # Must be falling (negative velocity)
    if player_y_velocity >= 0:
        return False
    
    # Must be above enemy
    if player_y <= enemy_y:
        return False
    
    # Must be close horizontally
    hit_radius = config.get("jump_hit_radius", 1.0)
    if distance_xz > hit_radius:
        return False
    
    # Must be within stomp range vertically (not too high)
    vertical_distance = player_y - enemy_y
    if vertical_distance > 3.0:  # Too high to register hit
        return False
    
    return True

def check_dash_attack(is_dashing: bool, distance: float, config: Dict) -> bool:
    """
    Check if player's dash should damage enemy
    
    Args:
        is_dashing: Whether player is currently dashing
        distance: Distance between player and enemy
        config: Combat config from get_combat_config()
    
    Returns:
        True if dash attack should register
    """
    
    if not is_dashing:
        return False
    
    if not config.get("can_attack", False):
        return False
    
    dash_damage = config.get("dash_damage", 0)
    if dash_damage <= 0:
        return False
    
    hit_radius = config.get("dash_hit_radius", 1.2)
    if distance > hit_radius:
        return False
    
    return True

