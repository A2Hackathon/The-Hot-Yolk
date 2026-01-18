from fastapi import APIRouter, HTTPException
from typing import Dict, List
import random
import math
from world.prompt_parser import parse_prompt
from world.terrain import generate_heightmap, get_walkable_points
from world.enemy_placer import place_enemies
from world.lighting import get_lighting_preset, get_sky_color
from world.physics_config import get_combined_config
from world.colour_scheme import assign_palette_to_elements
from models.generators import generate_object_template_with_ai

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
        "arctic": {"types": ["ice_rock", "boulder"], "density": 1.2, "min_height": 0.3},
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

def generate_street_lamps(
    heightmap_raw: List[List[float]],
    placement_mask: List[List[int]],
    biome: str,
    count: int = 20,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate street lamp positions for city biome."""
    street_lamps = []
    biome_lower = biome.lower()
    
    if biome_lower != "city":
        return []  # Only generate street lamps for city
    
    segments = len(heightmap_raw) - 1
    
    # Find valid points along walkable areas (roads/paths)
    valid_points = []
    for z in range(5, segments - 5):
        for x in range(5, segments - 5):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                # Street lamps need relatively flat ground
                if 0.15 <= h <= 0.5:
                    # Check neighbors for flatness
                    is_flat = True
                    for dz in range(-1, 2):
                        for dx in range(-1, 2):
                            if abs(heightmap_raw[z + dz][x + dx] - h) > 0.03:
                                is_flat = False
                                break
                        if not is_flat:
                            break
                    if is_flat:
                        valid_points.append((x, z))
    
    if not valid_points:
        print(f"[STREET_LAMPS] No valid points found for street lamps")
        return []
    
    # Place street lamps with spacing, closer to center
    random.shuffle(valid_points)
    placed_positions = []
    min_distance = 15  # Minimum distance between street lamps
    
    # Limit placement range to be closer to center (within 60 units of center instead of 128)
    center_range = 60  # Reduced from terrain_size/2 (128)
    
    for i in range(len(valid_points)):
        if len(street_lamps) >= count:
            break
        
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        
        # Filter to only place within center range
        if abs(world_x) > center_range or abs(world_z) > center_range:
            continue
        
        # Check distance from other street lamps
        too_close = False
        for px, pz in placed_positions:
            dist = math.sqrt((world_x - px)**2 + (world_z - pz)**2)
            if dist < min_distance:
                too_close = True
                break
        
        if too_close:
            continue
        
        world_y = heightmap_raw[z_idx][x_idx] * 10
        scale = random.uniform(0.9, 1.1)  # Slight variation in size
        rotation = random.uniform(0, math.pi * 2)
        
        street_lamps.append({
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        })
        
        placed_positions.append((world_x, world_z))
    
    print(f"[Structures] Placed {len(street_lamps)} street lamps")
    return street_lamps

def generate_buildings(
    heightmap_raw: List[List[float]],
    placement_mask: List[List[int]],
    biome: str,
    count: int = 10,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate buildings for city or arctic biomes."""
    buildings = []
    biome_lower = biome.lower()
    
    if biome_lower not in ["city", "arctic"]:
        return []  # Only generate buildings for city or arctic
    
    segments = len(heightmap_raw) - 1
    
    # --- Define building types ---
    if biome_lower == "city":
        building_types = [
            {"type": "skyscraper", "height": 70, "width": 10, "depth": 10, "color": 0x666666},
            {"type": "house", "height": 40, "width": 7, "depth": 10, "color": 0x777777},
            {"type": "skyscraper", "height": 50, "width": 8, "depth": 8, "color": 0x555555},
            {"type": "house", "height": 20, "width": 10, "depth": 7, "color": 0x888888},
        ]
    elif biome_lower == "arctic":
        building_types = [
            {"type": "igloo", "height": 3, "width": 5, "depth": 5, "color": 0xFFFFFF},
        ]
    
    # --- Find valid flat areas ---
    valid_points = []
    for z in range(10, segments - 10):
        for x in range(10, segments - 10):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                # Buildings need relatively flat ground
                if biome_lower == "city":
                    if 0.15 <= h <= 0.5:
                        # check neighbors for flatness
                        is_flat = True
                        for dz in range(-2, 3):
                            for dx in range(-2, 3):
                                if abs(heightmap_raw[z + dz][x + dx] - h) > 0.05:
                                    is_flat = False
                                    break
                            if not is_flat:
                                break
                        if is_flat:
                            valid_points.append((x, z))
                elif biome_lower == "arctic":
                    # Arctic igloos can be on slightly sloped terrain
                    if 0.0 <= h <= 0.7:
                        valid_points.append((x, z))
    
    if not valid_points:
        print(f"[BUILDINGS] No valid flat points found for {biome} buildings")
        return []
    
    # --- Place buildings with spacing ---
    random.shuffle(valid_points)
    placed_positions = []
    min_distance = 25 if biome_lower == "city" else 10  # smaller spacing for igloos
    
    for i in range(len(valid_points)):
        if len(buildings) >= count:
            break
        
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        
        # Check distance from other buildings
        too_close = False
        for px, pz in placed_positions:
            dist = math.sqrt((world_x - px)**2 + (world_z - pz)**2)
            if dist < min_distance:
                too_close = True
                break
        
        if too_close:
            continue
        
        world_y = heightmap_raw[z_idx][x_idx] * 10
        
        building_type = random.choice(building_types)
        rotation = random.choice([0, math.pi/2, math.pi, 3*math.pi/2])
        
        buildings.append({
            "type": building_type["type"],
            "height": building_type["height"],
            "width": building_type["width"],
            "depth": building_type["depth"],
            "color": building_type["color"],
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "rotation": float(rotation)
        })
        
        placed_positions.append((world_x, world_z))
    
    print(f"[Structures] Placed {len(buildings)} {biome} buildings")
    return buildings


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
        # #region agent log
        try:
            import json
            with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location":"generate.py:420","message":"Mountain peak generated","data":{"x":world_x,"y":h*10,"z":world_z,"scale":1.0},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","hypothesisId":"H4"})+'\n')
        except: pass
        # #endregion

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
    terrain_size: float = 256.0,
    existing_peaks: list = None
) -> list:
    """
    Generate trees using walkable points, independent of placed_tree_positions.
    Ensures trees appear even on flat arctic terrain.
    Excludes areas near mountain peaks to prevent collision.
    """
    segments = len(heightmap_raw) - 1
    trees = []
    
    if existing_peaks is None:
        existing_peaks = []

    biome_lower = biome.lower()
    is_winter = biome_lower in ["arctic", "winter", "icy", "snow", "frozen"]

    tree_types = {
        "arctic": ["pine", "spruce"],
        "city": ["oak", "maple"],
        "default": ["oak", "pine", "birch"]
    }
    types_for_biome = tree_types.get(biome_lower, tree_types["default"])

    # --- Gather all walkable points within placement_mask ---
    # Exclude areas near mountain peaks (mountain radius ~30 units, add buffer)
    MOUNTAIN_RADIUS = 30.0
    MIN_DISTANCE_FROM_PEAK = MOUNTAIN_RADIUS * 1.5  # Safety buffer
    
    valid_points = []
    for z in range(1, segments-1):
        for x in range(1, segments-1):
            if placement_mask[z][x] == 1:
                h = heightmap_raw[z][x]
                # Arctic allows flat terrain
                min_h = 0.0 if is_winter else 0.2
                max_h = 1.5 if is_winter else 1.0
                if min_h <= h <= max_h:
                    # Check distance from mountain peaks
                    world_x = (x / segments) * terrain_size - terrain_size / 2
                    world_z = (z / segments) * terrain_size - terrain_size / 2
                    
                    too_close_to_peak = False
                    for peak in existing_peaks:
                        peak_x = peak.get("position", {}).get("x", 0)
                        peak_z = peak.get("position", {}).get("z", 0)
                        peak_scale = peak.get("scale", 1.0)
                        distance = math.sqrt((world_x - peak_x)**2 + (world_z - peak_z)**2)
                        if distance < MIN_DISTANCE_FROM_PEAK * peak_scale:
                            too_close_to_peak = True
                            break
                    
                    if not too_close_to_peak:
                        valid_points.append((x, z))

    if not valid_points:
        print("[TREE DEBUG] ⚠️ No valid points found for trees! Trying fallback...")
        # Fallback: Try to find at least some points, even if conditions aren't perfect
        # This ensures plants are always placed
        for z in range(1, segments-1):
            for x in range(1, segments-1):
                if placement_mask[z][x] == 1:
                    world_x = (x / segments) * terrain_size - terrain_size / 2
                    world_z = (z / segments) * terrain_size - terrain_size / 2
                    too_close_to_peak = False
                    for peak in existing_peaks:
                        peak_x = peak.get("position", {}).get("x", 0)
                        peak_z = peak.get("position", {}).get("z", 0)
                        peak_scale = peak.get("scale", 1.0)
                        distance = math.sqrt((world_x - peak_x)**2 + (world_z - peak_z)**2)
                        if distance < MIN_DISTANCE_FROM_PEAK * peak_scale:
                            too_close_to_peak = True
                            break
                    if not too_close_to_peak:
                        valid_points.append((x, z))
                        if len(valid_points) >= tree_count:
                            break
            if len(valid_points) >= tree_count:
                break
        
        if not valid_points:
            print("[TREE DEBUG] ❌ Still no valid points after fallback! Using ultra-permissive placement...")
            # Last resort: place plants anywhere placement_mask allows (ignore height restrictions)
            for z in range(2, segments-2):
                for x in range(2, segments-2):
                    if placement_mask[z][x] == 1:
                        world_x = (x / segments) * terrain_size - terrain_size / 2
                        world_z = (z / segments) * terrain_size - terrain_size / 2
                        too_close_to_peak = False
                        for peak in existing_peaks:
                            peak_x = peak.get("position", {}).get("x", 0)
                            peak_z = peak.get("position", {}).get("z", 0)
                            peak_scale = peak.get("scale", 1.0)
                            distance = math.sqrt((world_x - peak_x)**2 + (world_z - peak_z)**2)
                            if distance < MIN_DISTANCE_FROM_PEAK * peak_scale:
                                too_close_to_peak = True
                                break
                        if not too_close_to_peak:
                            valid_points.append((x, z))
                            if len(valid_points) >= tree_count:
                                break
                if len(valid_points) >= tree_count:
                    break
        
        if not valid_points:
            print("[TREE DEBUG] ❌❌ CRITICAL: No valid points even with ultra-permissive placement!")
            return []

    random.shuffle(valid_points)
    trees_to_place = min(tree_count, len(valid_points))

    for i in range(trees_to_place):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10

        tree_type = random.choice(types_for_biome)
        scale = random.uniform(0.9, 1.5) * (2.5 if is_winter else 1.5)
        rotation = random.uniform(0, math.pi * 2)

        trees.append({
            "type": tree_type,
            "leafless": is_winter,
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "scale": float(scale),
            "rotation": float(rotation)
        })

    print(f"[TREE DEBUG] Placed {len(trees)} trees (requested: {tree_count}, biome={biome}, leafless={is_winter})")
    if len(trees) == 0:
        print(f"[TREE DEBUG] ⚠️ WARNING: No trees were placed! tree_count={tree_count}, valid_points={len(valid_points) if 'valid_points' in locals() else 0}")
    return trees

def generate_room_walls(room_size: float = 30.0, wall_height: float = 8.0, wall_color: str = "#E8E8E8") -> List[Dict]:
    """Generate 4 walls for a room biome"""
    walls = []
    half_size = room_size / 2
    wall_thickness = 0.5
    
    # North wall (back)
    walls.append({
        "type": "wall",
        "position": {"x": 0, "y": wall_height / 2, "z": -half_size},
        "dimensions": {"width": room_size, "height": wall_height, "depth": wall_thickness},
        "color": wall_color,
        "rotation": 0
    })
    # South wall (front)
    walls.append({
        "type": "wall", 
        "position": {"x": 0, "y": wall_height / 2, "z": half_size},
        "dimensions": {"width": room_size, "height": wall_height, "depth": wall_thickness},
        "color": wall_color,
        "rotation": 0
    })
    # East wall (right)
    walls.append({
        "type": "wall",
        "position": {"x": half_size, "y": wall_height / 2, "z": 0},
        "dimensions": {"width": wall_thickness, "height": wall_height, "depth": room_size},
        "color": wall_color,
        "rotation": 0
    })
    # West wall (left)
    walls.append({
        "type": "wall",
        "position": {"x": -half_size, "y": wall_height / 2, "z": 0},
        "dimensions": {"width": wall_thickness, "height": wall_height, "depth": room_size},
        "color": wall_color,
        "rotation": 0
    })
    # Floor
    walls.append({
        "type": "floor",
        "position": {"x": 0, "y": 0, "z": 0},
        "dimensions": {"width": room_size, "height": 0.2, "depth": room_size},
        "color": "#8B4513",  # Brown floor
        "rotation": 0
    })
    return walls


async def generate_scanned_object(obj_name: str, count: int = 1, room_size: float = 30.0) -> List[Dict]:
    """Generate 3D objects from scanned item names. Uses AI to generate templates for unknown objects."""
    objects = []
    obj_lower = obj_name.lower().replace(" ", "_").replace("-", "_")
    
    # Object definitions - simple geometric shapes
    object_templates = {
        "coffee_maker": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.4, "z": 0}, "dimensions": {"width": 0.4, "height": 0.8, "depth": 0.3}, "color": "#2C2C2C"},
                {"shape": "cylinder", "position": {"x": 0.1, "y": 0.6, "z": 0.2}, "radius": 0.08, "height": 0.3, "color": "#4A4A4A"},
            ],
            "scale": 1.0
        },
        "paper_towel": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.3, "z": 0}, "radius": 0.15, "height": 0.6, "color": "#FFFFFF"},
                {"shape": "cylinder", "position": {"x": 0, "y": 0.3, "z": 0}, "radius": 0.03, "height": 0.65, "color": "#8B4513"},
            ],
            "scale": 1.0
        },
        "chair": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.25, "z": 0}, "dimensions": {"width": 0.5, "height": 0.05, "depth": 0.5}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": 0, "y": 0.55, "z": -0.22}, "dimensions": {"width": 0.5, "height": 0.6, "depth": 0.05}, "color": "#8B4513"},
                {"shape": "cylinder", "position": {"x": -0.2, "y": 0.12, "z": -0.2}, "radius": 0.03, "height": 0.25, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": 0.2, "y": 0.12, "z": -0.2}, "radius": 0.03, "height": 0.25, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": -0.2, "y": 0.12, "z": 0.2}, "radius": 0.03, "height": 0.25, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": 0.2, "y": 0.12, "z": 0.2}, "radius": 0.03, "height": 0.25, "color": "#5C4033"},
            ],
            "scale": 1.0
        },
        "table": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.75, "z": 0}, "dimensions": {"width": 1.2, "height": 0.05, "depth": 0.8}, "color": "#8B4513"},
                {"shape": "cylinder", "position": {"x": -0.5, "y": 0.375, "z": -0.3}, "radius": 0.04, "height": 0.75, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": 0.5, "y": 0.375, "z": -0.3}, "radius": 0.04, "height": 0.75, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": -0.5, "y": 0.375, "z": 0.3}, "radius": 0.04, "height": 0.75, "color": "#5C4033"},
                {"shape": "cylinder", "position": {"x": 0.5, "y": 0.375, "z": 0.3}, "radius": 0.04, "height": 0.75, "color": "#5C4033"},
            ],
            "scale": 1.0
        },
        "couch": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.25, "z": 0}, "dimensions": {"width": 2.0, "height": 0.3, "depth": 0.8}, "color": "#4A6741"},
                {"shape": "box", "position": {"x": 0, "y": 0.55, "z": -0.35}, "dimensions": {"width": 2.0, "height": 0.6, "depth": 0.1}, "color": "#4A6741"},
                {"shape": "box", "position": {"x": -0.9, "y": 0.4, "z": 0}, "dimensions": {"width": 0.2, "height": 0.4, "depth": 0.8}, "color": "#3D5636"},
                {"shape": "box", "position": {"x": 0.9, "y": 0.4, "z": 0}, "dimensions": {"width": 0.2, "height": 0.4, "depth": 0.8}, "color": "#3D5636"},
            ],
            "scale": 1.0
        },
        "lamp": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.02, "z": 0}, "radius": 0.15, "height": 0.04, "color": "#2C2C2C"},
                {"shape": "cylinder", "position": {"x": 0, "y": 0.5, "z": 0}, "radius": 0.02, "height": 1.0, "color": "#C0C0C0"},
                {"shape": "cone", "position": {"x": 0, "y": 1.1, "z": 0}, "radius": 0.2, "height": 0.25, "color": "#FFFFD0"},
            ],
            "scale": 1.0
        },
        "bed": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.2, "z": 0}, "dimensions": {"width": 1.5, "height": 0.4, "depth": 2.0}, "color": "#FFFFFF"},
                {"shape": "box", "position": {"x": 0, "y": 0.5, "z": -0.9}, "dimensions": {"width": 1.5, "height": 0.6, "depth": 0.1}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": 0, "y": 0.45, "z": 0.7}, "dimensions": {"width": 1.3, "height": 0.15, "depth": 0.5}, "color": "#ADD8E6"},
            ],
            "scale": 1.0
        },
        "monitor": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.4, "z": 0}, "dimensions": {"width": 0.6, "height": 0.4, "depth": 0.05}, "color": "#1A1A1A"},
                {"shape": "box", "position": {"x": 0, "y": 0.38, "z": 0}, "dimensions": {"width": 0.55, "height": 0.35, "depth": 0.02}, "color": "#4169E1"},
                {"shape": "box", "position": {"x": 0, "y": 0.1, "z": 0.05}, "dimensions": {"width": 0.08, "height": 0.2, "depth": 0.08}, "color": "#2C2C2C"},
                {"shape": "box", "position": {"x": 0, "y": 0.02, "z": 0.05}, "dimensions": {"width": 0.25, "height": 0.02, "depth": 0.15}, "color": "#2C2C2C"},
            ],
            "scale": 1.0
        },
        "plant": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.15, "z": 0}, "radius": 0.12, "height": 0.3, "color": "#8B4513"},
                {"shape": "sphere", "position": {"x": 0, "y": 0.4, "z": 0}, "radius": 0.2, "color": "#228B22"},
                {"shape": "sphere", "position": {"x": 0.1, "y": 0.5, "z": 0.05}, "radius": 0.15, "color": "#2E8B2E"},
                {"shape": "sphere", "position": {"x": -0.08, "y": 0.45, "z": -0.05}, "radius": 0.12, "color": "#32CD32"},
            ],
            "scale": 1.0
        },
        "book": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.02, "z": 0}, "dimensions": {"width": 0.15, "height": 0.04, "depth": 0.2}, "color": "#8B0000"},
            ],
            "scale": 1.0
        },
        "cup": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.05, "z": 0}, "radius": 0.04, "height": 0.1, "color": "#FFFFFF"},
            ],
            "scale": 1.0
        },
        "bottle": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.1, "z": 0}, "radius": 0.04, "height": 0.2, "color": "#87CEEB"},
                {"shape": "cylinder", "position": {"x": 0, "y": 0.22, "z": 0}, "radius": 0.02, "height": 0.05, "color": "#4169E1"},
            ],
            "scale": 1.0
        },
        "microwave": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.2, "z": 0}, "dimensions": {"width": 0.6, "height": 0.4, "depth": 0.45}, "color": "#2C2C2C"},
                {"shape": "box", "position": {"x": -0.1, "y": 0.2, "z": 0.21}, "dimensions": {"width": 0.35, "height": 0.3, "depth": 0.02}, "color": "#1A1A1A"},
                {"shape": "box", "position": {"x": 0.2, "y": 0.2, "z": 0.21}, "dimensions": {"width": 0.1, "height": 0.25, "depth": 0.02}, "color": "#3C3C3C"},
            ],
            "scale": 1.0
        },
        "cabinet": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.5, "z": 0}, "dimensions": {"width": 0.8, "height": 1.0, "depth": 0.4}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": -0.15, "y": 0.5, "z": 0.19}, "dimensions": {"width": 0.3, "height": 0.8, "depth": 0.02}, "color": "#A0522D"},
                {"shape": "box", "position": {"x": 0.15, "y": 0.5, "z": 0.19}, "dimensions": {"width": 0.3, "height": 0.8, "depth": 0.02}, "color": "#A0522D"},
            ],
            "scale": 1.0
        },
        "shelf": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 1.0, "z": 0}, "dimensions": {"width": 1.2, "height": 0.03, "depth": 0.25}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": -0.58, "y": 0.5, "z": 0}, "dimensions": {"width": 0.04, "height": 1.0, "depth": 0.25}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": 0.58, "y": 0.5, "z": 0}, "dimensions": {"width": 0.04, "height": 1.0, "depth": 0.25}, "color": "#8B4513"},
            ],
            "scale": 1.0
        },
        "bowl": {
            "parts": [
                {"shape": "cylinder", "position": {"x": 0, "y": 0.05, "z": 0}, "radius": 0.12, "height": 0.1, "color": "#FFFFFF"},
            ],
            "scale": 1.0
        },
        "door": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 1.0, "z": 0}, "dimensions": {"width": 0.9, "height": 2.0, "depth": 0.08}, "color": "#A0522D"},
                {"shape": "sphere", "position": {"x": 0.35, "y": 0.9, "z": 0.05}, "radius": 0.04, "color": "#FFD700"},
            ],
            "scale": 1.0
        },
        "light_switch": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 1.2, "z": 0}, "dimensions": {"width": 0.08, "height": 0.12, "depth": 0.02}, "color": "#F5F5F5"},
                {"shape": "box", "position": {"x": 0, "y": 1.2, "z": 0.015}, "dimensions": {"width": 0.03, "height": 0.05, "depth": 0.01}, "color": "#FFFFFF"},
            ],
            "scale": 1.0
        },
        "refrigerator": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.9, "z": 0}, "dimensions": {"width": 0.8, "height": 1.8, "depth": 0.7}, "color": "#C0C0C0"},
                {"shape": "box", "position": {"x": 0, "y": 1.5, "z": 0.34}, "dimensions": {"width": 0.75, "height": 0.6, "depth": 0.02}, "color": "#D3D3D3"},
                {"shape": "box", "position": {"x": 0, "y": 0.6, "z": 0.34}, "dimensions": {"width": 0.75, "height": 1.0, "depth": 0.02}, "color": "#D3D3D3"},
            ],
            "scale": 1.0
        },
        "stove": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.45, "z": 0}, "dimensions": {"width": 0.8, "height": 0.9, "depth": 0.6}, "color": "#2C2C2C"},
                {"shape": "cylinder", "position": {"x": -0.2, "y": 0.92, "z": -0.1}, "radius": 0.1, "height": 0.02, "color": "#1A1A1A"},
                {"shape": "cylinder", "position": {"x": 0.2, "y": 0.92, "z": -0.1}, "radius": 0.1, "height": 0.02, "color": "#1A1A1A"},
                {"shape": "cylinder", "position": {"x": -0.2, "y": 0.92, "z": 0.15}, "radius": 0.08, "height": 0.02, "color": "#1A1A1A"},
                {"shape": "cylinder", "position": {"x": 0.2, "y": 0.92, "z": 0.15}, "radius": 0.08, "height": 0.02, "color": "#1A1A1A"},
            ],
            "scale": 1.0
        },
        "sink": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.45, "z": 0}, "dimensions": {"width": 0.6, "height": 0.9, "depth": 0.5}, "color": "#808080"},
                {"shape": "box", "position": {"x": 0, "y": 0.85, "z": 0}, "dimensions": {"width": 0.5, "height": 0.15, "depth": 0.4}, "color": "#C0C0C0"},
                {"shape": "cylinder", "position": {"x": 0, "y": 1.1, "z": -0.15}, "radius": 0.02, "height": 0.3, "color": "#C0C0C0"},
            ],
            "scale": 1.0
        },
        "tv": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 0.5, "z": 0}, "dimensions": {"width": 1.2, "height": 0.7, "depth": 0.08}, "color": "#1A1A1A"},
                {"shape": "box", "position": {"x": 0, "y": 0.48, "z": 0}, "dimensions": {"width": 1.1, "height": 0.62, "depth": 0.02}, "color": "#000080"},
                {"shape": "box", "position": {"x": 0, "y": 0.1, "z": 0.1}, "dimensions": {"width": 0.3, "height": 0.2, "depth": 0.15}, "color": "#1A1A1A"},
            ],
            "scale": 1.0
        },
        "window": {
            "parts": [
                {"shape": "box", "position": {"x": 0, "y": 1.5, "z": 0}, "dimensions": {"width": 1.0, "height": 1.2, "depth": 0.1}, "color": "#8B4513"},
                {"shape": "box", "position": {"x": 0, "y": 1.5, "z": 0.03}, "dimensions": {"width": 0.9, "height": 1.1, "depth": 0.02}, "color": "#87CEEB"},
            ],
            "scale": 1.0
        },
    }
    
    # Get template from predefined list, or generate with AI
    template = object_templates.get(obj_lower)
    
    if not template:
        # Try to generate template with AI
        print(f"[OBJECT] '{obj_name}' not in templates, asking AI to design it...")
        ai_template = await generate_object_template_with_ai(obj_name)
        
        if ai_template and "parts" in ai_template:
            template = ai_template
            print(f"[OBJECT] ✅ AI generated template for '{obj_name}' with {len(template['parts'])} parts")
        else:
            # Fallback: Generic object - create a simple colored box
            print(f"[OBJECT] ⚠️ AI failed, using generic box for '{obj_name}'")
            template = {
                "parts": [
                    {"shape": "box", "position": {"x": 0, "y": 0.25, "z": 0}, "dimensions": {"width": 0.5, "height": 0.5, "depth": 0.5}, "color": "#808080"},
                ],
                "scale": 0.8
            }
    
    # Generate requested count of objects at random positions
    half_room = room_size / 2 - 2  # Keep away from walls
    for i in range(count):
        pos_x = random.uniform(-half_room, half_room)
        pos_z = random.uniform(-half_room, half_room)
        
        obj = {
            "name": f"{obj_name}_{i+1}",
            "type": "scanned_object",
            "original_name": obj_name,
            "position": {"x": pos_x, "y": 0, "z": pos_z},
            "scale": template["scale"],
            "parts": template["parts"],
            "rotation": random.uniform(0, math.pi * 2)
        }
        objects.append(obj)
    
    return objects


@router.post("/generate-world")
async def generate_world(prompt: Dict) -> Dict:
    try:
        prompt_text = prompt.get("prompt", "")
        scan_data = prompt.get("scan_data", {})  # New: structured scan data from Overshoot
        
        if not prompt_text:
            raise HTTPException(status_code=400, detail="No prompt provided")

        print("\n" + "="*60)
        print("[Backend] Received prompt:", prompt_text)
        if scan_data:
            print("[Backend] Scan data:", scan_data)
        
        # Check if this is a room/indoor scan
        is_room = scan_data.get("is_room", False) or "room" in prompt_text.lower()
        scanned_biome = scan_data.get("biome", "")
        if scanned_biome == "room" or scan_data.get("terrain") == "indoor":
            is_room = True
        
        if is_room:
            print("[Backend] 🏠 ROOM BIOME DETECTED - generating indoor environment")
            return await generate_room_world_from_scan(scan_data)
        
        parsed_params = parse_prompt(prompt_text)
        print("[Backend] Parsed params:", parsed_params)
        
        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "both")
        structure_counts = parsed_params.get("structure", {})
        color_palette = parsed_params.get("color_palette", [])
        plant_type = parsed_params.get("plant_type", "tree")  # Default to tree

        print(f"[Backend] Final biome: '{biome}' | time: '{time_of_day}' | color_palette: {color_palette}")

        # --- Generate terrain with color palette ---
        terrain_data = generate_heightmap(biome, structure_counts, color_palette=color_palette)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]

        # --- Generate 3D structures ---
        # Default tree/plant count: 25 for arctic, 15 for desert (cacti), 15 for others (increased from 10)
        # Plants should always be present (cactus for desert, trees for others, etc.)
        if biome.lower() in ["desert", "sandy"]:
            base_tree_count = 15  # Cacti for desert
        elif biome.lower() in ["arctic", "winter", "icy"]:
            base_tree_count = 25  # Trees for arctic
        elif biome.lower() == "city":
            base_tree_count = 0  # City biomes can have 0 trees (or use building_count instead)
        else:
            base_tree_count = 15  # Default trees/plants (increased from 10)
        
        # Use base_tree_count if AI returned a low value (below minimum) or if not specified
        ai_tree_count = structure_counts.get("tree")
        if ai_tree_count is None:
            tree_count = base_tree_count
        else:
            # For desert, ensure at least base_tree_count (15) even if AI suggests fewer
            if biome.lower() in ["desert", "sandy"]:
                tree_count = max(ai_tree_count, base_tree_count)
            else:
                tree_count = ai_tree_count
        
        # Ensure minimum plant count (plants are always present in any biome)
        tree_count = max(tree_count, 5)  # Minimum 5 plants in any world
        print(f"[Backend] Tree/plant count: {tree_count} (from structure_counts: {structure_counts.get('tree', 'not set')}, base: {base_tree_count})")

        base_rock_count = 15 if biome.lower() in ["arctic", "winter", "icy"] else 10 if biome.lower() == "city" else 20
        rock_count = structure_counts.get("rock", base_rock_count)
        mountain_count = structure_counts.get("mountain", 3 if biome.lower() in ["arctic", "winter", "icy"] else 0)
        
        # Building count for city biome
        building_count = structure_counts.get("building", 15 if biome.lower() == "city" else 0)
        
        # Street lamp count for city biome (limited to 3 to avoid texture unit limits)
        street_lamp_count = structure_counts.get("street_lamp", 3 if biome.lower() == "city" else 0)

        terrain_size = 256

        # Generate peaks first (they affect tree placement)
        peaks = generate_mountain_peaks(heightmap_raw, biome, terrain_size, max_peaks=mountain_count) if mountain_count > 0 else []
        
        structures = {
            "trees": place_trees_on_terrain(
                heightmap_raw=heightmap_raw,
                placement_mask=placement_mask,
                biome=biome,
                tree_count=tree_count,
                terrain_size=terrain_size,
                existing_peaks=peaks  # Pass peaks so trees avoid them
            ),
            "rocks": generate_rocks(heightmap_raw, biome, rock_count, terrain_size),
            "peaks": peaks,
            "buildings": generate_buildings(heightmap_raw, placement_mask, biome, building_count, terrain_size),
            "street_lamps": generate_street_lamps(heightmap_raw, placement_mask, biome, street_lamp_count, terrain_size)
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
        
        # --- Generate color assignments from palette ---
        color_assignments = {}
        if color_palette and isinstance(color_palette, list) and len(color_palette) > 0:
            print(f"[Backend] Color palette received: {color_palette} (length: {len(color_palette)})")
            color_assignments = assign_palette_to_elements(color_palette)
            print(f"[Backend] Generated color assignments from palette: {len(color_assignments)} elements")
            print(f"[Backend] Color assignments keys: {list(color_assignments.keys())}")
            if "sky" in color_assignments:
                print(f"[Backend] ✅ Sky color from assignments: {color_assignments['sky']}")
            else:
                print(f"[Backend] ⚠️ WARNING: 'sky' not found in color_assignments!")
        else:
            print(f"[Backend] ⚠️ WARNING: No color_palette provided, using default colors")
        
        print(f"[Backend] Lighting config: {lighting_config}")
        print(f"[Backend] Sky color: {sky_colour}")
        print("="*60 + "\n")

        # --- Get plant_type from parsed params ---
        plant_type = parsed_params.get("plant_type", "tree")  # Default to tree if not specified
        
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
                "colour_map_array": terrain_data.get('colour_map_array'),
                "color_palette": color_palette,
                "color_assignments": color_assignments,
                "plant_type": plant_type
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


@router.post("/generate-room")
async def generate_room_endpoint(request: Dict) -> Dict:
    """Dedicated endpoint for generating room/indoor environments from camera scans"""
    print("\n" + "="*60)
    print("[ROOM ENDPOINT] Received room generation request")
    print(f"[ROOM ENDPOINT] Request data: {request}")
    
    return await generate_room_world_from_scan(request)


async def generate_room_world_from_scan(scan_data: Dict) -> Dict:
    """Generate a room/indoor environment with walls and scanned objects"""
    try:
        print("[ROOM] ========================================")
        print("[ROOM] Generating indoor room environment...")
        print(f"[ROOM] Scan data: {scan_data}")
        
        room_size = 30.0  # Room is 30x30 units
        wall_height = 8.0
        
        # Get colors from scan data
        colors = scan_data.get("colors", ["#E8E8E8", "#8B4513", "#FFFFFF"])
        wall_color = colors[0] if colors else "#E8E8E8"
        floor_color = colors[1] if len(colors) > 1 else "#8B4513"
        
        print(f"[ROOM] Wall color: {wall_color}, Floor color: {floor_color}")
        
        # Generate walls
        walls = generate_room_walls(room_size, wall_height, wall_color)
        # Update floor color
        for wall in walls:
            if wall.get("type") == "floor":
                wall["color"] = floor_color
        
        print(f"[ROOM] Generated {len(walls)} walls/floor")
        
        # Generate scanned objects
        scanned_objects = []
        custom_objects = scan_data.get("custom_objects", [])
        all_objects = scan_data.get("objects", {})
        
        print(f"[ROOM] Custom objects from request: {custom_objects}")
        print(f"[ROOM] All objects from request: {all_objects}")
        
        # Process custom objects from scan_data.custom_objects
        for obj_info in custom_objects:
            obj_name = obj_info.get("name", "unknown")
            obj_count = obj_info.get("count", 1)
            if obj_count > 0:
                print(f"[ROOM] 📦 Generating {obj_count}x '{obj_name}'...")
                generated = await generate_scanned_object(obj_name, obj_count, room_size)
                scanned_objects.extend(generated)
                print(f"[ROOM]    → Created {len(generated)} object(s)")
        
        # Also process any objects from the objects dict that aren't standard outdoor types
        outdoor_types = ["tree", "rock", "building", "mountain", "peak", "street_lamp"]
        processed_names = [o.get("name", "").lower().replace(" ", "_") for o in custom_objects]
        
        for obj_name, count in all_objects.items():
            obj_lower = obj_name.lower().replace(" ", "_")
            # Skip outdoor types and already processed objects
            if obj_lower in outdoor_types:
                continue
            if obj_lower in processed_names:
                continue
            
            obj_count = count if isinstance(count, int) else 1
            if obj_count > 0:
                print(f"[ROOM] 📦 Generating {obj_count}x '{obj_name}' from objects dict...")
                generated = await generate_scanned_object(obj_name, obj_count, room_size)
                scanned_objects.extend(generated)
                print(f"[ROOM]    → Created {len(generated)} object(s)")
        
        print(f"[ROOM] Generated {len(scanned_objects)} scanned objects")
        
        # Create flat heightmap for room (very small, flat terrain)
        segments = 64
        heightmap_raw = [[0.1 for _ in range(segments + 1)] for _ in range(segments + 1)]
        placement_mask = [[1 for _ in range(segments + 1)] for _ in range(segments + 1)]
        
        # Create flat color map (floor color)
        r = int(floor_color[1:3], 16)
        g = int(floor_color[3:5], 16)
        b = int(floor_color[5:7], 16)
        colour_map_array = [[[r, g, b] for _ in range(segments + 1)] for _ in range(segments + 1)]
        
        # Spawn point in center of room
        spawn_point = {"x": 0.0, "y": 1.0, "z": 0.0}
        
        # Indoor lighting - bright ambient, soft shadows (matching frontend expected format)
        lighting_config = {
            "ambient": {
                "color": "#FFFAF0",  # Warm white
                "intensity": 1.0
            },
            "directional": {
                "color": "#FFFFFF",
                "intensity": 0.5,
                "position": {"x": 0, "y": 20, "z": 0}  # Light from above
            },
            "fog": None,  # No fog indoors
            "background": "#F5F5F5",  # Light ceiling
            "northern_lights": False
        }
        
        # Room sky color (ceiling color - light gray/white)
        sky_colour = "#F5F5F5"
        
        # Physics config
        from world.physics_config import get_combined_config
        configs = get_combined_config("both")
        
        response = {
            "world": {
                "biome": "room",
                "biome_name": "room",
                "time": "noon",
                "heightmap_raw": heightmap_raw,
                "heightmap_url": None,
                "texture_url": None,
                "lighting_config": lighting_config,
                "sky_colour": sky_colour,
                "colour_map_array": colour_map_array,
                "is_room": True,
                "room_size": room_size
            },
            "structures": {
                "trees": [],  # No trees in rooms
                "rocks": [],  # No rocks in rooms
                "peaks": [],
                "buildings": [],
                "street_lamps": [],
                "walls": walls,  # Room walls
                "scanned_objects": scanned_objects  # Objects from camera scan
            },
            "combat": {
                "enemy_count": 0,
                "enemies": [],
                "combat_config": configs["combat"]
            },
            "physics": configs["physics"],
            "spawn_point": spawn_point
        }
        
        print(f"[ROOM] ✅ Room world generated with {len(walls)} walls and {len(scanned_objects)} objects")
        return response
        
    except Exception as e:
        print(f"[ROOM ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Room generation failed: {str(e)}")