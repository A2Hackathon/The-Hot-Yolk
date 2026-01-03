from fastapi import APIRouter, HTTPException
from typing import Dict, List
import random
import math
from world.prompt_parser import parse_prompt
from world.terrain import generate_heightmap, get_walkable_points
from world.enemy_placer import place_enemies
from world.lighting import get_lighting_preset, get_sky_color
from world.physics_config import get_combined_config

router = APIRouter()

def generate_trees(
    heightmap_raw: List[List[float]],
    placement_mask: List[List[int]],
    biome: str,
    count: int = 30,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate tree positions"""
    trees = []
    segments = len(heightmap_raw) - 1
    
    tree_config = {
        "arctic": {"types": ["pine", "spruce"], "density": 0.5, "min_height": 0.3, "max_height": 1.0},
        "city": {"types": ["oak", "maple"], "density": 0.3, "min_height": 0.2, "max_height": 0.7},
        "default": {"types": ["oak", "pine", "birch"], "density": 1.0, "min_height": 0.2, "max_height": 0.9}
    }
    
    config = tree_config.get(biome, tree_config["default"])
    adjusted_count = int(count * config["density"])
    
    valid_points = []
    for z in range(5, segments - 5):
        for x in range(5, segments - 5):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                if config["min_height"] <= h <= config["max_height"]:
                    valid_points.append((x, z))
    
    if not valid_points:
        return []
    
    random.shuffle(valid_points)
    for i in range(min(adjusted_count, len(valid_points))):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10
        
        tree_type = random.choice(config["types"])
        scale = random.uniform(0.8, 1.4)
        rotation = random.uniform(0, math.pi * 2)
        
        trees.append({
            "type": tree_type,
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        })
    
    print(f"[Structures] Placed {len(trees)} trees")
    return trees

def generate_rocks(
    heightmap_raw: List[List[float]],
    biome: str,
    count: int = 20,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate rock/boulder positions"""
    rocks = []
    segments = len(heightmap_raw) - 1
    
    rock_config = {
        "arctic": {"types": ["ice_rock", "boulder"], "density": 1.2, "min_height": 0.4},
        "city": {"types": ["decorative_rock"], "density": 0.2, "min_height": 0.2},
        "default": {"types": ["boulder", "rock"], "density": 1.0, "min_height": 0.3}
    }
    
    config = rock_config.get(biome, rock_config["default"])
    adjusted_count = int(count * config["density"])
    
    valid_points = []
    for z in range(5, segments - 5):
        for x in range(5, segments - 5):
            h = heightmap_raw[z][x]
            if h >= config["min_height"]:
                valid_points.append((x, z))
    
    if not valid_points:
        return []
    
    random.shuffle(valid_points)
    for i in range(min(adjusted_count, len(valid_points))):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10
        
        rock_type = random.choice(config["types"])
        scale = random.uniform(0.6, 1.8)
        rotation = random.uniform(0, math.pi * 2)
        
        rocks.append({
            "type": rock_type,
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        })
    
    print(f"[Structures] Placed {len(rocks)} rocks")
    return rocks

def generate_mountain_peaks(
    heightmap_raw: List[List[float]],
    biome: str,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate mountain peak markers on highest points"""
    peaks = []
    segments = len(heightmap_raw) - 1
    
    if biome not in ["arctic"]:
        return []
    
    threshold = 1.0
    peak_positions = []
    
    for z in range(10, segments - 10):
        for x in range(10, segments - 10):
            h = heightmap_raw[z][x]
            if h < threshold:
                continue
            
            is_peak = True
            for dz in range(-5, 6):
                for dx in range(-5, 6):
                    if dx == 0 and dz == 0:
                        continue
                    neighbor_h = heightmap_raw[z + dz][x + dx]
                    if neighbor_h >= h:
                        is_peak = False
                        break
                if not is_peak:
                    break
            
            if is_peak:
                peak_positions.append((x, z, h))
    
    for x_idx, z_idx, height in peak_positions[:8]:
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = height * 10
        
        peaks.append({
            "type": "peak",
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "height": float(height),
            "scale": 1.5
        })
    
    print(f"[Structures] Placed {len(peaks)} mountain peaks")
    return peaks

@router.post("/generate-world")
async def generate_world(prompt: Dict) -> Dict:
    try:
        prompt_text = prompt.get("prompt", "")
        if not prompt_text:
            raise HTTPException(status_code=400, detail="No prompt provided")

        print("[Backend] Received prompt:", prompt_text)
        parsed_params = parse_prompt(prompt_text)
        print("[Backend] Parsed params:", parsed_params)
        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "both")
        structure_counts = parsed_params.get("structure", {})

        # --- Generate terrain ---
        terrain_data = generate_heightmap(biome, structure_counts)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]

        # --- Generate 3D structures ---
        base_tree_count = 40 if biome == "arctic" else 25 if biome == "city" else 50
        tree_count = structure_counts.get("tree", base_tree_count)
        
        base_rock_count = 30 if biome == "arctic" else 10 if biome == "city" else 20
        rock_count = structure_counts.get("rock", base_rock_count)
        
        structures = {
            "trees": generate_trees(heightmap_raw, placement_mask, biome, tree_count, 256.0),
            "rocks": generate_rocks(heightmap_raw, biome, rock_count, 256.0),
            "peaks": generate_mountain_peaks(heightmap_raw, biome, 256.0)
        }

        # --- Determine player spawn on a walkable point ---
        walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
        if not walkable_points:
            raise HTTPException(status_code=500, detail="No valid player spawn points")

        spawn_idx_x, spawn_idx_z = random.choice(walkable_points)
        terrain_size = 256
        segments = len(heightmap_raw) - 1

        spawn_x = (spawn_idx_x / segments) * terrain_size - terrain_size / 2
        spawn_z = (spawn_idx_z / segments) * terrain_size - terrain_size / 2
        spawn_y = heightmap_raw[spawn_idx_z][spawn_idx_x] * 10 + 0.5

        spawn_point = {"x": float(spawn_x), "y": float(spawn_y), "z": float(spawn_z)}

        # --- Place enemies ---
        enemies = place_enemies(
            heightmap_raw=heightmap_raw,
            placement_mask=placement_mask,
            enemy_count=enemy_count,
            player_spawn=spawn_point
        )

        # --- Physics + combat config ---
        configs = get_combined_config(weapon)

        # --- Lighting and sky ---
        lighting_config = get_lighting_preset(time_of_day)
        sky_colour = get_sky_color(time_of_day)

        # --- Build response ---
        response = {
            "world": {
                "biome": biome,
                "time": time_of_day,
                "heightmap_raw": heightmap_raw,
                "heightmap_url": terrain_data.get("heightmap_url"),
                "texture_url": terrain_data.get("texture_url"),
                "lighting_config": lighting_config,
                "sky_colour": sky_colour,
                "colour_map_array": terrain_data.get('colour_map_array')
            },
            "structures": structures,
            "combat": {
                "enemy_count": len(enemies),
                "enemies": enemies,
                "combat_config": configs["combat"]
            },
            "physics": configs["physics"],
            "spawn_point": spawn_point
        }

        return response

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))