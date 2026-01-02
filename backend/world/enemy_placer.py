import random
import math
from typing import List, Dict
from .weapon_config import get_enemy_stats
from .terrain import get_walkable_points

def distance_2d(x1: float, z1: float, x2: float, z2: float) -> float:
    return math.sqrt((x2 - x1)**2 + (z2 - z1)**2)

def is_too_close_to_others(x: float, z: float, enemies: List[Dict], min_distance: float) -> bool:
    for enemy in enemies:
        ex = enemy["position"]["x"]
        ez = enemy["position"]["z"]
        if distance_2d(x, z, ex, ez) < min_distance:
            return True
    return False

def place_enemies(
    heightmap_raw: List[List[float]],
    placement_mask: List[List[int]],
    enemy_count: int,
    player_spawn: Dict[str, float],
    min_player_distance: float = 20.0,
    min_enemy_distance: float = 10.0,
    terrain_size: float = 128.0  # must match your frontend PlaneGeometry
) -> List[Dict]:

    enemy_stats = get_enemy_stats("sentinel")
    segments = len(heightmap_raw) - 1

    # 1. Get all walkable points from terrain (indices)
    walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
    if not walkable_points:
        print("[Enemy Placer] WARNING: No valid spawn points found!")
        return []

    # 2. Filter points far enough from player (player world coords mapped to index)
    player_x_idx = int((player_spawn["x"] + terrain_size / 2) / terrain_size * segments)
    player_z_idx = int((player_spawn["z"] + terrain_size / 2) / terrain_size * segments)

    spawnable_points = [
        (x_idx, z_idx) for (x_idx, z_idx) in walkable_points
        if distance_2d(x_idx, z_idx, player_x_idx, player_z_idx) >= min_player_distance
    ]

    if not spawnable_points:
        print("[Enemy Placer] WARNING: No spawnable points far from player!")
        return []

    random.shuffle(spawnable_points)
    enemies = []
    attempts = 0
    max_attempts = 500

    # 3. Place enemies
    while len(enemies) < enemy_count and attempts < max_attempts:
        attempts += 1
        if not spawnable_points:
            break

        x_idx, z_idx = spawnable_points.pop()

        # Map indices to world coordinates
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10 + 0.5  # scale + half enemy height

        if is_too_close_to_others(world_x, world_z, enemies, min_enemy_distance):
            continue

        enemies.append({
            "id": len(enemies) + 1,
            "position": {
                "x": float(world_x),
                "y": float(world_y),
                "z": float(world_z)
            },
            "type": "sentinel",
            "behavior": "patrol",
            "health": enemy_stats["health"],
            "max_health": enemy_stats["health"],
            "damage": enemy_stats["damage"],
            "speed": enemy_stats["speed"],
            "detection_radius": enemy_stats["detection_radius"],
            "attack_radius": enemy_stats["attack_radius"]
        })

    print(f"[Enemy Placer] Placed {len(enemies)}/{enemy_count} enemies (attempts: {attempts})")
    return enemies
