
import random
import math
from typing import List, Dict, Tuple
from .weapon_config import get_enemy_stats
from .terrain import get_valid_spawn_points 

def distance_2d(x1: float, z1: float, x2: float, z2: float) -> float:
    return math.sqrt((x2 - x1)**2 + (z2 - z1)**2)

def is_too_close_to_others(x: int, z: int, enemies: List[Dict], min_distance: float) -> bool:
    for enemy in enemies:
        ex = enemy["position"]["x"]
        ez = enemy["position"]["z"]
        if distance_2d(x, z, ex, ez) < min_distance:
            return True
    return False

def place_enemies(heightmap_raw: List[List[float]],
                  placement_mask: List[List[int]],
                  enemy_count: int,
                  player_spawn: Dict[str, float],
                  min_player_distance: float = 20.0,
                  min_enemy_distance: float = 10.0) -> List[Dict]:
    """
    Place enemies with combat stats from weapon_config
    
    Returns:
        List of enemies with position, health, damage, speed
    """
    
    # Get enemy stats
    enemy_stats = get_enemy_stats("sentinel")
    
    valid_points = get_valid_spawn_points(placement_mask, player_spawn, min_player_distance)
    
    if not valid_points:
        print(f"[Enemy Placer] WARNING: No valid spawn points found!")
        return []
    
    print(f"[Enemy Placer] Found {len(valid_points)} valid spawn points")
    
    enemies = []
    attempts = 0
    max_attempts = 500
    
    random.shuffle(valid_points)
    
    while len(enemies) < enemy_count and attempts < max_attempts:
        attempts += 1
        
        if not valid_points:
            print(f"[Enemy Placer] Ran out of valid points, placed {len(enemies)}/{enemy_count} enemies")
            break
        
        x, z = valid_points.pop()
        
        if is_too_close_to_others(x, z, enemies, min_enemy_distance):
            continue
        
        y = heightmap_raw[z][x]
        
        enemy_id = len(enemies) + 1
        enemies.append({
            "id": enemy_id,
            "position": {
                "x": float(x),
                "y": float(y) + 0.5,
                "z": float(z)
            },
            "type": "sentinel",
            "behavior": "patrol",
            "health": enemy_stats["health"],
            "max_health": enemy_stats["health"],  # For health bars
            "damage": enemy_stats["damage"],
            "speed": enemy_stats["speed"],
            "detection_radius": enemy_stats["detection_radius"],
            "attack_radius": enemy_stats["attack_radius"]
        })
    
    print(f"[Enemy Placer] Placed {len(enemies)}/{enemy_count} enemies (attempts: {attempts})")
    
    return enemies