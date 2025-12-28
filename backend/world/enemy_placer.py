"""
Enemy placement logic using terrain placement mask
Ensures enemies spawn on walkable terrain with good distribution
"""

import random
import math
from typing import List, Dict, Tuple

def distance_2d(x1: float, z1: float, x2: float, z2: float) -> float:
    """Calculate 2D distance between two points (ignoring Y)"""
    return math.sqrt((x2 - x1)**2 + (z2 - z1)**2)

def is_too_close_to_others(x: int, z: int, enemies: List[Dict], min_distance: float) -> bool:
    """Check if position is too close to existing enemies"""
    for enemy in enemies:
        ex = enemy["position"]["x"]
        ez = enemy["position"]["z"]
        if distance_2d(x, z, ex, ez) < min_distance:
            return True
    return False

def get_valid_spawn_points(placement_mask: List[List[int]], 
                           player_spawn: Dict[str, float],
                           min_player_distance: float = 20.0) -> List[Tuple[int, int]]:
    """
    Get all valid spawn points from placement mask
    Excludes area too close to player spawn
    
    Args:
        placement_mask: 2D list where 1 = walkable, 0 = blocked
        player_spawn: {"x": 64, "y": 10, "z": 64}
        min_player_distance: Minimum distance from player spawn
    
    Returns:
        List of (x, z) tuples that are valid spawn points
    """
    valid_points = []
    height = len(placement_mask)
    width = len(placement_mask[0])
    
    px = player_spawn["x"]
    pz = player_spawn["z"]
    
    for z in range(height):
        for x in range(width):
            # Check if walkable
            if placement_mask[z][x] == 1:
                # Check distance from player
                if distance_2d(x, z, px, pz) >= min_player_distance:
                    valid_points.append((x, z))
    
    return valid_points

def place_enemies(heightmap_raw: List[List[float]],
                  placement_mask: List[List[int]],
                  enemy_count: int,
                  player_spawn: Dict[str, float],
                  min_player_distance: float = 20.0,
                  min_enemy_distance: float = 10.0) -> List[Dict]:
    """
    Place enemies on terrain using placement mask
    
    Args:
        heightmap_raw: 2D list of height values for Y positioning
        placement_mask: 2D list where 1 = walkable, 0 = blocked
        enemy_count: Number of enemies to spawn (3-8)
        player_spawn: {"x": 64, "y": 10, "z": 64}
        min_player_distance: Minimum distance from player
        min_enemy_distance: Minimum distance between enemies
    
    Returns:
        List of enemy dicts with id, position, type, behavior
    """
    
    # Get all valid spawn points
    valid_points = get_valid_spawn_points(placement_mask, player_spawn, min_player_distance)
    
    if not valid_points:
        print(f"[Enemy Placer] WARNING: No valid spawn points found!")
        return []
    
    print(f"[Enemy Placer] Found {len(valid_points)} valid spawn points")
    
    enemies = []
    attempts = 0
    max_attempts = 500  # Prevent infinite loop
    
    # Shuffle valid points for randomness
    random.shuffle(valid_points)
    
    while len(enemies) < enemy_count and attempts < max_attempts:
        attempts += 1
        
        # Pick a random valid point
        if not valid_points:
            print(f"[Enemy Placer] Ran out of valid points, placed {len(enemies)}/{enemy_count} enemies")
            break
        
        x, z = valid_points.pop()
        
        # Check distance from other enemies
        if is_too_close_to_others(x, z, enemies, min_enemy_distance):
            continue
        
        # Get height at this position
        y = heightmap_raw[z][x]
        
        # Add enemy
        enemy_id = len(enemies) + 1
        enemies.append({
            "id": enemy_id,
            "position": {
                "x": float(x),
                "y": float(y) + 0.5,  # Slight offset so not embedded in ground
                "z": float(z)
            },
            "type": "sentinel",  # Only one type for MVP
            "behavior": "patrol"  # Frontend will implement FSM
        })
    
    print(f"[Enemy Placer] Placed {len(enemies)}/{enemy_count} enemies (attempts: {attempts})")
    
    return enemies

def place_enemies_clustered(heightmap_raw: List[List[float]],
                            placement_mask: List[List[int]],
                            enemy_count: int,
                            player_spawn: Dict[str, float],
                            cluster_radius: float = 15.0) -> List[Dict]:
    """
    Alternative placement: spawn enemies in small clusters
    Good for boss fight or defend-the-point scenarios
    
    Args:
        heightmap_raw: 2D list of height values
        placement_mask: 2D list where 1 = walkable
        enemy_count: Number of enemies
        player_spawn: Player spawn position
        cluster_radius: Radius of cluster
    
    Returns:
        List of enemy dicts
    """
    valid_points = get_valid_spawn_points(placement_mask, player_spawn, min_player_distance=30.0)
    
    if not valid_points:
        return []
    
    # Pick cluster center
    center_x, center_z = random.choice(valid_points)
    
    enemies = []
    attempts = 0
    max_attempts = 500
    
    while len(enemies) < enemy_count and attempts < max_attempts:
        attempts += 1
        
        # Generate point within cluster radius
        angle = random.uniform(0, 2 * math.pi)
        distance = random.uniform(0, cluster_radius)
        
        x = int(center_x + distance * math.cos(angle))
        z = int(center_z + distance * math.sin(angle))
        
        # Check bounds
        height = len(placement_mask)
        width = len(placement_mask[0])
        if x < 0 or x >= width or z < 0 or z >= height:
            continue
        
        # Check if walkable
        if placement_mask[z][x] != 1:
            continue
        
        # Check minimum distance from other enemies
        if is_too_close_to_others(x, z, enemies, min_enemy_distance=5.0):
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
            "behavior": "aggressive"  # Clustered enemies are more aggressive
        })
    
    print(f"[Enemy Placer] Clustered {len(enemies)}/{enemy_count} enemies at ({center_x}, {center_z})")
    
    return enemies


# Example usage
if __name__ == "__main__":
    # Simulate a simple terrain
    size = 128
    
    # Create fake heightmap (flat with some variation)
    heightmap = [[0.5 + random.uniform(-0.1, 0.1) for _ in range(size)] for _ in range(size)]
    
    # Create fake placement mask (70% walkable)
    placement_mask = [[1 if random.random() > 0.3 else 0 for _ in range(size)] for _ in range(size)]
    
    # Player spawn in center
    player_spawn = {"x": 64, "y": 0.5, "z": 64}
    
    # Test placement
    print("=== Testing Standard Placement ===")
    enemies = place_enemies(
        heightmap_raw=heightmap,
        placement_mask=placement_mask,
        enemy_count=6,
        player_spawn=player_spawn
    )
    
    print(f"\nPlaced {len(enemies)} enemies:")
    for enemy in enemies:
        pos = enemy["position"]
        print(f"  Enemy {enemy['id']}: ({pos['x']:.1f}, {pos['y']:.2f}, {pos['z']:.1f})")
    
    print("\n=== Testing Clustered Placement ===")
    enemies_clustered = place_enemies_clustered(
        heightmap_raw=heightmap,
        placement_mask=placement_mask,
        enemy_count=5,
        player_spawn=player_spawn
    )
    
    print(f"\nPlaced {len(enemies_clustered)} clustered enemies:")
    for enemy in enemies_clustered:
        pos = enemy["position"]
        print(f"  Enemy {enemy['id']}: ({pos['x']:.1f}, {pos['y']:.2f}, {pos['z']:.1f})")