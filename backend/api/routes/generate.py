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
    """Generate tree positions with biome-specific characteristics"""
    trees = []
    segments = len(heightmap_raw) - 1
    
    # CRITICAL: Check if biome is winter/arctic/icy
    biome_lower = biome.lower()
    is_winter = biome_lower in ["arctic", "winter", "icy", "snow", "frozen"]
    
    print(f"[TREE DEBUG] Biome: '{biome}' | Is Winter: {is_winter}")
    
    tree_config = {
        "arctic": {
            "types": ["pine", "spruce"], 
            "density": 0.7, 
            "min_height": 0.3, 
            "max_height": 1.0,
            "scale_boost": 3.0,  # Larger trees in arctic
            "leafless": True  # No leaves in winter/arctic
        },
        "city": {
            "types": ["oak", "maple"], 
            "density": 0.3, 
            "min_height": 0.2, 
            "max_height": 0.7,
            "scale_boost": 2.0,
            "leafless": False  # Normal trees with leaves
        },
        "default": {
            "types": ["oak", "pine", "birch"], 
            "density": 1.0, 
            "min_height": 0.2, 
            "max_height": 0.9,
            "scale_boost": 1.5,
            "leafless": False  # Normal trees with leaves
        }
    }
    
    # Get config for this biome
    config = tree_config.get(biome_lower, tree_config["default"]).copy()
    
    # OVERRIDE leafless based on winter check
    config["leafless"] = is_winter
    
    print(f"[TREE DEBUG] Final config leafless: {config['leafless']}")
    
    adjusted_count = int(count * config["density"])
    
    valid_points = []
    for z in range(5, segments - 5):
        for x in range(5, segments - 5):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                if config["min_height"] <= h <= config["max_height"]:
                    valid_points.append((x, z))
    
    if not valid_points:
        print("[TREE DEBUG] No valid points found!")
        return []
    
    random.shuffle(valid_points)
    for i in range(min(adjusted_count, len(valid_points))):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10
        
        tree_type = random.choice(config["types"])
        scale = random.uniform(0.9, 1.5) * config["scale_boost"]
        rotation = random.uniform(0, math.pi * 2)
        
        tree_data = {
            "type": tree_type,
            "leafless": config["leafless"],  # This should be True for winter
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        }
        
        # Debug first tree
        if i == 0:
            print(f"[TREE DEBUG] First tree data: {tree_data}")
        
        trees.append(tree_data)
    
    print(f"[Structures] Placed {len(trees)} trees (leafless={config['leafless']}, biome={biome})")
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
    
    config = rock_config.get(biome.lower(), rock_config["default"])
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
    heightmap_raw,
    biome,
    terrain_size=256.0,
    max_peaks=3
):
    if max_peaks == 0:
        return []
    
    if biome.lower() not in ["arctic", "winter", "icy", "snow", "frozen"]:
        return []

    segments = len(heightmap_raw) - 1

    # === MUST match frontend cone geometry ===
    MOUNTAIN_RADIUS = 30.0
    MIN_DISTANCE = MOUNTAIN_RADIUS * 2.6  # visual safety buffer

    HEIGHT_THRESHOLD = 0.75
    peaks = []
    placed_positions = []

    # --- Find candidate peak cells ---
    candidates = []
    for z in range(2, segments - 2):
        for x in range(2, segments - 2):
            h = heightmap_raw[z][x]
            if h < HEIGHT_THRESHOLD:
                continue

            is_peak = True
            for dz in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    if dx == 0 and dz == 0:
                        continue
                    if heightmap_raw[z + dz][x + dx] > h + 0.02:
                        is_peak = False
                        break
                if not is_peak:
                    break

            if is_peak:
                candidates.append((x, z, h))

    if not candidates:
        print("[PEAK DEBUG] No peak candidates found")
        return []

    # --- Place peaks by spatial separation only ---
    for x_idx, z_idx, h in candidates:
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2

        too_close = False
        for px, pz in placed_positions:
            dx = world_x - px
            dz = world_z - pz
            if dx * dx + dz * dz < MIN_DISTANCE * MIN_DISTANCE:
                too_close = True
                break

        if too_close:
            continue

        peaks.append({
            "type": "peak",
            "position": {
                "x": float(world_x),
                "y": float(h * 10),
                "z": float(world_z)
            },
            "scale": 1.0
        })

        placed_positions.append((world_x, world_z))

        if len(peaks) >= max_peaks:
            break

    print(f"[Structures] Placed {len(peaks)} mountain peaks (radius-based)")
    return peaks


def place_trees_on_terrain(
    heightmap_raw, 
    placement_mask, 
    biome: str, 
    tree_count: int = 40, 
    terrain_size: float = 256.0
) -> list:
    """
    Generate trees using walkable points, independent of placed_tree_positions.
    Ensures trees appear even on flat arctic terrain.
    """
    segments = len(heightmap_raw) - 1
    trees = []

    biome_lower = biome.lower()
    is_winter = biome_lower in ["arctic", "winter", "icy", "snow", "frozen"]

    tree_types = {
        "arctic": ["pine", "spruce"],
        "city": ["oak", "maple"],
        "default": ["oak", "pine", "birch"]
    }
    types_for_biome = tree_types.get(biome_lower, tree_types["default"])

    # --- Gather all walkable points within placement_mask ---
    valid_points = []
    for z in range(1, segments-1):
        for x in range(1, segments-1):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                # Arctic allows flat terrain
                min_h = 0.0 if is_winter else 0.2
                max_h = 1.5 if is_winter else 1.0
                if min_h <= h <= max_h:
                    valid_points.append((x, z))

    if not valid_points:
        print("[TREE DEBUG] No valid points found for trees!")
        return []

    random.shuffle(valid_points)
    trees_to_place = min(tree_count, len(valid_points))

    for i in range(trees_to_place):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10

        tree_type = random.choice(types_for_biome)
        scale = random.uniform(0.9, 1.5) * (3.0 if is_winter else 1.5)
        rotation = random.uniform(0, math.pi * 2)

        trees.append({
            "type": tree_type,
            "leafless": is_winter,
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        })

    print(f"[TREE DEBUG] Placed {len(trees)} trees (biome={biome}, leafless={is_winter})")
    return trees

@router.post("/generate-world")
async def generate_world(prompt: Dict) -> Dict:
    try:
        prompt_text = prompt.get("prompt", "")
        if not prompt_text:
            raise HTTPException(status_code=400, detail="No prompt provided")

        print("\n" + "="*60)
        print("[Backend] Received prompt:", prompt_text)
        parsed_params = parse_prompt(prompt_text)
        print("[Backend] Parsed params:", parsed_params)
        
        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "both")
        structure_counts = parsed_params.get("structure", {})

        print(f"[Backend] Final biome: '{biome}' | time: '{time_of_day}'")

        # --- Generate terrain ---
        terrain_data = generate_heightmap(biome, structure_counts)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]

        # --- Generate 3D structures ---
        base_tree_count = 40 if biome.lower() in ["arctic", "winter", "icy"] else 25 if biome.lower() == "city" else 50
        tree_count = structure_counts.get("tree", base_tree_count)

        base_rock_count = 30 if biome.lower() in ["arctic", "winter", "icy"] else 10 if biome.lower() == "city" else 20
        rock_count = structure_counts.get("rock", base_rock_count)
        mountain_count = structure_counts.get("mountain", 3 if biome.lower() in ["arctic", "winter", "icy"] else 0)

        terrain_size = 256

        structures = {
            "trees": place_trees_on_terrain(
                heightmap_raw=heightmap_raw,
                placement_mask=placement_mask,
                biome=biome,
                tree_count=tree_count,
                terrain_size=terrain_size
            ),
            "rocks": generate_rocks(heightmap_raw, biome, rock_count, terrain_size),
            "peaks": generate_mountain_peaks(heightmap_raw, biome, terrain_size, max_peaks=mountain_count) if mountain_count > 0 else [] 
        }

        # --- Determine player spawn on a walkable point ---
        walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
        if not walkable_points:
            raise HTTPException(status_code=500, detail="No valid player spawn points")

        spawn_idx_x, spawn_idx_z = random.choice(walkable_points)
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

        # --- Lighting and sky (now biome-aware) ---
        lighting_config = get_lighting_preset(time_of_day, biome)
        sky_colour = get_sky_color(time_of_day, biome)
        
        print(f"[Backend] Lighting config: {lighting_config}")
        print(f"[Backend] Sky color: {sky_colour}")
        print("="*60 + "\n")

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
        print(f"[Backend ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))