from fastapi import APIRouter, HTTPException
import os
print("LOADING GENERATE.PY ------------------------------------")
from typing import Dict, List, Optional

from pydantic import BaseModel
import random
import math
import json
from world.prompt_parser import parse_prompt, get_groq_client
from world.terrain import generate_heightmap, get_walkable_points
from world.color_scheme import assign_palette_to_elements
from world.enemy_placer import place_enemies
from world.lighting import get_lighting_preset, get_sky_color
from world.physics_config import get_combined_config
from world.overshoot_integration import analyze_environment, generate_world_from_scan, analyze_with_openai_vision

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
    
    # CRITICAL: Check if biome is winter/arctic/icy or lava
    biome_lower = biome.lower()
    is_winter = biome_lower in ["arctic", "winter", "icy", "snow", "frozen"]
    is_lava = biome_lower in ["lava", "volcanic", "volcano", "magma", "molten"]
    
    print(f"[TREE DEBUG] Biome: '{biome}' | Is Winter: {is_winter} | Is Lava: {is_lava}")
    
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
        "lava": {
            "types": [],  # No trees in lava biome
            "density": 0.0, 
            "min_height": 0.0, 
            "max_height": 0.0,
            "scale_boost": 1.0,
            "leafless": True
        },
        "volcanic": {
            "types": [],  # No trees in volcanic biome
            "density": 0.0, 
            "min_height": 0.0, 
            "max_height": 0.0,
            "scale_boost": 1.0,
            "leafless": True
        },
        "volcano": {
            "types": [],  # No trees in volcano biome
            "density": 0.0, 
            "min_height": 0.0, 
            "max_height": 0.0,
            "scale_boost": 1.0,
            "leafless": True
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
    terrain_size: float = 256.0,
    placement_mask: Optional[List[List[int]]] = None
) -> List[Dict]:
    """Generate rock/boulder positions (excludes mountains via placement_mask)"""
    rocks = []
    segments = len(heightmap_raw) - 1
    
    rock_config = {
        "arctic": {"types": ["ice_rock", "boulder"], "density": 1.2, "min_height": 0.3},
        "city": {"types": ["decorative_rock"], "density": 0.2, "min_height": 0.2},
        "lava": {"types": ["lava_rock", "volcanic_rock", "boulder"], "density": 1.5, "min_height": 0.3},
        "volcanic": {"types": ["lava_rock", "volcanic_rock", "boulder"], "density": 1.5, "min_height": 0.3},
        "volcano": {"types": ["lava_rock", "volcanic_rock", "boulder"], "density": 1.5, "min_height": 0.3},
        "default": {"types": ["boulder", "rock"], "density": 1.0, "min_height": 0.3}
    }
    
    config = rock_config.get(biome.lower(), rock_config["default"])
    adjusted_count = int(count * config["density"])
    
    valid_points = []
    for z in range(5, segments - 5):
        for x in range(5, segments - 5):
            h = heightmap_raw[z][x]
            # Only place rocks where placement_mask allows (excludes mountains)
            # If no placement_mask provided, use height check only
            if placement_mask is not None:
                if placement_mask[z][x] != 1:  # Skip if not walkable (includes mountains)
                    continue
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
        scale = random.uniform(0.3, 0.7)  # Reduced size (was 0.6-1.8)
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


def generate_glowing_flowers(
    heightmap_raw: List[List[float]],
    placement_mask: List[List[int]],
    biome: str,
    count: int = 30,
    terrain_size: float = 256.0
) -> List[Dict]:
    """Generate glowing blue flowers for arctic biomes"""
    flowers = []
    
    # Only generate for arctic biomes
    if biome.lower() not in ["arctic", "winter", "icy", "snow", "frozen"]:
        return flowers
    
    segments = len(heightmap_raw) - 1
    
    # Get valid points from placement mask
    valid_points = []
    for z in range(2, segments - 2):
        for x in range(2, segments - 2):
            if placement_mask[z][x] == 1:  # Walkable area
                valid_points.append((x, z))
    
    if not valid_points:
        print(f"[FLOWERS] No valid points found for flowers in {biome} biome")
        return flowers
    
    print(f"[FLOWERS] Found {len(valid_points)} valid points for flower placement in {biome}")
    random.shuffle(valid_points)
    flowers_to_place = min(count, len(valid_points))
    
    for i in range(flowers_to_place):
        x_idx, z_idx = valid_points[i]
        world_x = (x_idx / segments) * terrain_size - terrain_size / 2
        world_z = (z_idx / segments) * terrain_size - terrain_size / 2
        world_y = heightmap_raw[z_idx][x_idx] * 10
        
        # Vary height - longer stems
        stem_height = random.uniform(1.5, 3.0)  # Longer stems (was 0.3-1.5)
        stem_curve = random.uniform(-0.3, 0.3)  # More pronounced curve (was -0.1 to 0.1)
        
        # Flower scale - bigger petals
        flower_scale = random.uniform(1.5, 2.0)  # Bigger petals (was 0.8-1.2)
        
        # Rotation
        rotation = random.uniform(0, math.pi * 2)
        
        flowers.append({
            "type": "glowing_flower",
            "position": {"x": float(world_x), "y": float(world_y), "z": float(world_z)},
            "stem_height": float(stem_height),
            "stem_curve": float(stem_curve),
            "scale": float(flower_scale),
            "rotation": float(rotation)
        })
    
    print(f"[Structures] Placed {len(flowers)} glowing blue flowers for {biome}")
    if len(flowers) > 0:
        print(f"[FLOWERS] First flower position: {flowers[0]['position']}")
    return flowers

def generate_mountain_peaks(
    heightmap_raw,
    biome,
    terrain_size=256.0,
    max_peaks=3
):
    if max_peaks == 0:
        return []
    
    biome_lower = biome.lower()
    # Allow mountains for arctic/winter biomes AND lava/volcanic biomes
    if biome_lower not in ["arctic", "winter", "icy", "snow", "frozen", "lava", "volcanic", "volcano", "magma"]:
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
    is_lava = biome_lower in ["lava", "volcanic", "volcano", "magma", "molten"]

    # No trees in lava biomes
    if is_lava:
        print(f"[TREE DEBUG] Lava biome detected - no trees will be placed")
        return []

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
        scale = random.uniform(0.9, 1.5) * (2.5 if is_winter else 1.5)
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
        print("[Backend] Prompt check - contains 'gotham':", "gotham" in prompt_text.lower())
        parsed_params = parse_prompt(prompt_text)
        print("[Backend] Parsed params:", parsed_params)
        
        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        print(f"[Backend] After parse_prompt: biome='{biome}', time='{time_of_day}'")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "both")
        structure_counts = parsed_params.get("structure", {})
        creative_objects = parsed_params.get("creative_objects", [])  # Get custom objects from AI
        color_palette = parsed_params.get("color_palette", [])
        # Ensure color_palette is always a list
        if not isinstance(color_palette, list):
            if isinstance(color_palette, str):
                color_palette = [color_palette]
            else:
                color_palette = []
        special_effects = parsed_params.get("special_effects", [])
        biome_description = parsed_params.get("biome_description", "")
        
        if creative_objects:
            print(f"[Backend] AI suggested {len(creative_objects)} creative objects: {[obj.get('name', 'unknown') for obj in creative_objects]}")

        print(f"[Backend] Final biome: '{biome}' | time: '{time_of_day}' | colors: {color_palette}")
        print(f"[Backend] Full parsed_params: {json.dumps(parsed_params, indent=2)}")
        
        # Safety check: If user wrote "gotham" but biome is "city", force correction
        if "gotham" in prompt_text.lower() or "batman" in prompt_text.lower():
            if biome.lower() != "gotham":
                print(f"[Backend] 🚨 CRITICAL: User wrote '{prompt_text}' but biome is '{biome}' - FORCING to 'gotham'")
                biome = "gotham"
                time_of_day = "night"
                color_palette = []  # Empty so lighting.py generates dark colors
                print(f"[Backend] ✅ CRITICAL FIX: biome='gotham', time='night', colors=[]")
        if biome_description:
            print(f"[Backend] Biome description: {biome_description}")

        # --- Set up structure counts BEFORE terrain generation ---
        # Use AI-suggested structure counts if provided, otherwise use intelligent defaults
        # The AI parser now suggests context-aware counts, so prioritize those
        
        # Initialize all count variables to None first
        tree_count = None
        rock_count = None
        mountain_count = None
        building_count = None
        street_lamp_count = None
        
        # Ensure structure_counts is a dict (default to empty if None or falsy)
        if not structure_counts:
            structure_counts = {}
        
        # Extract AI-suggested counts if structure_counts has values
        if structure_counts:
            tree_count = structure_counts.get("tree", None)
            rock_count = structure_counts.get("rock", None)
            mountain_count = structure_counts.get("mountain", None)
            building_count = structure_counts.get("building", None)
            street_lamp_count = structure_counts.get("street_lamp", None)
            
            print(f"[Backend] Using AI-suggested structure counts: trees={tree_count}, rocks={rock_count}, mountains={mountain_count}, buildings={building_count}, street_lamps={street_lamp_count}")
        
        # Apply intelligent defaults only if AI didn't suggest a count
        if tree_count is None:
            base_tree_count = 25 if biome.lower() in ["arctic", "winter", "icy"] else 10
            tree_count = base_tree_count
        if rock_count is None:
            base_rock_count = 5  # Reduced from 15/10/20 to 5 for all biomes
            rock_count = base_rock_count
        if mountain_count is None:
            # Default: 1 huge mountain for arctic, 0 for other biomes
            mountain_count = 1 if biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"] else 0
        
        # CRITICAL: Ensure structure_counts has mountain count BEFORE calling generate_heightmap
        # so that mountains are generated in the terrain mesh
        structure_counts["mountain"] = mountain_count
        
        # --- Generate terrain ---
        # Pass color_palette and structure_counts to terrain generator for dynamic biome support
        terrain_data = generate_heightmap(biome, structure_counts, color_palette=color_palette)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]
        
        # Assign colors to landscape elements if palette is provided
        color_assignments = {}
        # Ensure color_palette is a list before checking length
        if color_palette and isinstance(color_palette, list) and len(color_palette) > 0:
            color_assignments = assign_palette_to_elements(color_palette)
            print(f"[Backend] Assigned colors to elements: {list(color_assignments.keys())}")

        # --- Generate 3D structures ---
        
        if building_count is None:
            # Generate buildings for city and futuristic/cyberpunk biomes
            if biome.lower() == "city":
                building_count = 15
            elif biome.lower() in ["futuristic", "cyberpunk", "neon"]:
                building_count = 25  # More buildings for futuristic cities
            else:
                building_count = 0
        if street_lamp_count is None:
            # Limited to avoid texture unit limits
            # Generate street lamps for city and futuristic/cyberpunk biomes
            if biome.lower() == "city":
                street_lamp_count = 3
            elif biome.lower() in ["futuristic", "cyberpunk", "neon"]:
                street_lamp_count = 8  # More street lamps for futuristic cities
            else:
                street_lamp_count = 0
        
        # Ensure non-negative counts
        tree_count = max(0, int(tree_count)) if tree_count is not None else 0
        rock_count = max(0, int(rock_count)) if rock_count is not None else 0
        mountain_count = max(0, int(mountain_count)) if mountain_count is not None else 0
        building_count = max(0, int(building_count)) if building_count is not None else 0
        street_lamp_count = max(0, int(street_lamp_count)) if street_lamp_count is not None else 0
        
        print(f"[Backend] Final structure counts: trees={tree_count}, rocks={rock_count}, mountains={mountain_count}, buildings={building_count}, street_lamps={street_lamp_count}")
        if creative_objects:
            print(f"[Backend] Creative objects from AI: {len(creative_objects)} objects")
            for obj in creative_objects:
                print(f"  - {obj.get('name', 'unknown')} at ({obj.get('position', {}).get('x', 0):.1f}, {obj.get('position', {}).get('z', 0):.1f})")
        else:
            print(f"[Backend] No creative objects from AI parser")

        terrain_size = 256

        # Mountains are now generated directly in the terrain mesh, not as separate structures
        # Keep peaks as empty array for compatibility (frontend will skip rendering them)
        peaks = []
        
        # Generate glowing flowers for arctic biomes (default count)
        flower_count = 30 if biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"] else 0
        flowers = generate_glowing_flowers(heightmap_raw, placement_mask, biome, flower_count, terrain_size)
        
        structures = {
            "trees": place_trees_on_terrain(
                heightmap_raw=heightmap_raw,
                placement_mask=placement_mask,
                biome=biome,
                tree_count=tree_count,
                terrain_size=terrain_size,
                existing_peaks=peaks  # Pass empty peaks (mountains are in terrain now)
            ),
            "rocks": generate_rocks(heightmap_raw, biome, rock_count, terrain_size, placement_mask),
            "peaks": peaks,  # Empty - mountains are now part of terrain mesh
            "buildings": generate_buildings(heightmap_raw, placement_mask, biome, building_count, terrain_size),
            "street_lamps": generate_street_lamps(heightmap_raw, placement_mask, biome, street_lamp_count, terrain_size),
            "flowers": flowers,  # Glowing blue flowers for arctic
            "creative_objects": creative_objects  # Include custom objects from AI parser
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

        # --- ABSOLUTE FINAL CHECK BEFORE lighting generation - CANNOT BE BYPASSED ---
        prompt_check = prompt_text.lower()
        original_biome = biome
        original_time = time_of_day
        
        if "gotham" in prompt_check or "batman" in prompt_check:
            if biome.lower() != "gotham":
                print(f"[Backend] 🔴🔴🔴 FINAL CHECK: Prompt='{prompt_text}', biome was '{biome}' - FORCING TO 'gotham'")
                biome = "gotham"
                time_of_day = "night"
                print(f"[Backend] ✅✅✅ FORCED: biome='{biome}', time='{time_of_day}'")
        elif "metropolis" in prompt_check or "superman" in prompt_check:
            if biome.lower() != "metropolis":
                print(f"[Backend] 🚨 FINAL CHECK: Forcing biome to 'metropolis' (was '{biome}')")
                biome = "metropolis"
                time_of_day = "noon"
        elif "tokyo" in prompt_check:
            if biome.lower() != "tokyo":
                print(f"[Backend] 🚨 FINAL CHECK: Forcing biome to 'tokyo' (was '{biome}')")
                biome = "tokyo"
        elif "spiderman" in prompt_check or "spider" in prompt_check:
            if biome.lower() not in ["spiderman_world", "spiderman"]:
                print(f"[Backend] 🚨 FINAL CHECK: Forcing biome to 'spiderman_world' (was '{biome}')")
                biome = "spiderman_world"
        
        if biome != original_biome:
            print(f"[Backend] ⚠️ BIOME WAS CHANGED: '{original_biome}' → '{biome}'")
        
        print(f"[Backend] ✅ FINAL VALUES BEFORE LIGHTING: biome='{biome}', time='{time_of_day}'")
        
        # --- Physics + combat config ---
        configs = get_combined_config(weapon)

        # --- Lighting and sky (now biome-aware) - uses CORRECTED biome/time ---
        lighting_config = get_lighting_preset(time_of_day, biome)
        sky_colour = get_sky_color(time_of_day, biome)
        
        print(f"[Backend] Lighting config: {lighting_config}")
        print(f"[Backend] Sky color: {sky_colour}")
        print("="*60 + "\n")
        
        # Add color information to structures if color_assignments are available
        # For arctic biomes, use blue/icy colors for trees by default
        is_arctic = biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"]
        default_leaf_color = "#5B9BD5" if is_arctic else "#228B22"  # Light blue for arctic, green otherwise
        default_trunk_color = "#4A7BA7" if is_arctic else "#8b4513"  # Blue-grey for arctic, brown otherwise
        
        if color_assignments:
            # Add color info to trees
            if structures.get("trees"):
                for tree in structures["trees"]:
                    if isinstance(tree, dict):
                        tree["leaf_color"] = color_assignments.get("tree_leaves", default_leaf_color)
                        tree["trunk_color"] = color_assignments.get("tree_trunk", default_trunk_color)
        elif is_arctic:
            # If no color_assignments but arctic biome, still set blue tree colors
            if structures.get("trees"):
                for tree in structures["trees"]:
                    if isinstance(tree, dict):
                        tree["leaf_color"] = default_leaf_color
                        tree["trunk_color"] = default_trunk_color
            
            # Add color info to buildings (they'll use building color when created)
            # Note: Buildings use color from color_assignments in frontend
        
        # --- Build response ---
        response = {
            "world": {
                "biome": biome,  # Use corrected biome
                "time": time_of_day,  # Use corrected time
                "heightmap_raw": heightmap_raw,
                "heightmap_url": terrain_data.get("heightmap_url"),
                "texture_url": terrain_data.get("texture_url"),
                "lighting_config": lighting_config,
                "sky_colour": sky_colour,
                "colour_map_array": terrain_data.get('colour_map_array'),
                "color_assignments": color_assignments,  # Include color assignments
                "color_palette": color_palette  # Include original palette
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


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage]


@router.post("/chat")
async def chat(request: ChatRequest) -> Dict:
    """
    Interactive chat endpoint for world generation.
    AI asks clarifying questions before generating to prevent hallucination.
    """
    try:
        client = get_groq_client()
        
        # Build conversation history
        messages = [
            {
                "role": "system",
                "content": """You are a helpful AI assistant that helps users create 3D game worlds. 
Your job is to understand what the user wants and ask clarifying questions if needed to prevent misunderstandings.

IMPORTANT RULES:
1. If the user's request is vague or unclear, ask ONE specific clarifying question
2. If you understand the request clearly, summarize what you'll create and ask: "Sounds good! Do you want me to start generating now?"
3. Be friendly and conversational
4. Keep responses concise (1-2 sentences for questions, 2-3 for confirmations)
5. Focus on understanding: biome (arctic/city/default), time of day, structures (trees, buildings, etc.), and enemy count

When you're ready to generate, end your message with: "Sounds good! Do you want me to start generating now?"

Return ONLY your response text, no JSON, no markdown formatting."""
            }
        ]
        
        # Add conversation history
        for msg in request.messages:
            messages.append({
                "role": msg.role,
                "content": msg.content
            })
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=messages,
            temperature=0.7,
            max_tokens=200
        )
        
        response_text = completion.choices[0].message.content.strip()
        
        # Check if AI is ready to generate
        ready_to_generate = "start generating now" in response_text.lower() or "generate now" in response_text.lower()
        
        return {
            "message": response_text,
            "ready_to_generate": ready_to_generate
        }
        
    except Exception as e:
        print(f"[Chat ERROR] {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


class ScanRequest(BaseModel):
    image_data: Optional[str] = None
    streaming_analysis: Optional[Dict] = None
    use_streaming: Optional[bool] = False  # Base64 encoded image


def generate_trees_with_colors(
    heightmap_raw,
    placement_mask,
    biome: str,
    count: int,
    terrain_size: float = 256.0,
    leaf_color: Optional[str] = None,
    trunk_color: Optional[str] = None,
    existing_peaks: list = None
) -> List[Dict]:
    """Enhanced tree generation with custom colors from Overshoot scan."""
    trees = place_trees_on_terrain(
        heightmap_raw=heightmap_raw,
        placement_mask=placement_mask,
        biome=biome,
        tree_count=count,
        terrain_size=terrain_size,
        existing_peaks=existing_peaks
    )
    
    # Apply custom colors if provided
    if leaf_color or trunk_color:
        for tree in trees:
            if leaf_color:
                tree["leaf_color"] = leaf_color
            if trunk_color:
                tree["trunk_color"] = trunk_color
    
    return trees


@router.post("/scan-world")
async def scan_world(request: ScanRequest) -> Dict:
    """
    Generate world from camera scan using Overshoot AI.
    """
    try:
        print("[SCAN] Processing scan request...")
        print(f"[SCAN] Has image_data: {request.image_data is not None}")
        print(f"[SCAN] Has streaming_analysis: {request.streaming_analysis is not None}")
        
        scan_data = None
        
        # PRIORITY 1: Analyze image with OpenAI Vision API (most accurate visual analysis)
        if request.image_data:
            print("[SCAN] 📸 Analyzing image with OpenAI Vision API...")
            print(f"[SCAN] Received image_data length: {len(request.image_data)} characters")
            
            if len(request.image_data) < 100:
                raise HTTPException(status_code=400, detail=f"Image data too small ({len(request.image_data)} chars). Make sure camera captured the image properly.")
            
            # Analyze image with OpenAI Vision API for detailed visual analysis
            try:
                vision_scan_data = await analyze_environment(request.image_data)
                print(f"[SCAN] ✅ OpenAI Vision analysis complete: biome={vision_scan_data.get('biome') if vision_scan_data else 'None'}")
            except Exception as vision_error:
                error_msg = f"OpenAI Vision analysis failed: {str(vision_error)}"
                print(f"[SCAN ERROR] {error_msg}")
                import traceback
                traceback.print_exc()
                raise HTTPException(status_code=500, detail=error_msg)
            
            if vision_scan_data:
                scan_data = vision_scan_data
                
                # ENHANCEMENT: If we also have Overshoot streaming description, combine both for maximum accuracy
                if request.streaming_analysis and isinstance(request.streaming_analysis, dict):
                    description = request.streaming_analysis.get("description", "")
                    if description:
                        print("[SCAN] 🎯 Combining OpenAI Vision + Overshoot description for maximum accuracy...")
                        print(f"[SCAN] Overshoot description: {description[:200]}...")
                        
                        # Parse description as prompt to extract semantic details
                        description_params = parse_prompt(description)
                        
                        # Enhance vision analysis with description insights
                        # Vision provides structured data (biome, objects, colors)
                        # Description provides contextual details and semantic understanding
                        
                        # Refine biome from description (more context-aware)
                        if description_params.get("biome"):
                            desc_biome = description_params["biome"]
                            print(f"[SCAN] Description suggests biome: {desc_biome} (Vision detected: {scan_data.get('biome')})")
                            # Prefer description biome if it's more specific, otherwise use vision
                            scan_data["biome"] = desc_biome
                        
                        # Extract time of day from description
                        if description_params.get("time"):
                            time_from_desc = description_params["time"]
                            print(f"[SCAN] Description suggests time: {time_from_desc}")
                            scan_data["time"] = time_from_desc
                        
                        # Merge color palettes (combine vision colors with description colors)
                        if description_params.get("color_palette"):
                            desc_colors = description_params["color_palette"]
                            print(f"[SCAN] Description suggests colors: {desc_colors} (type: {type(desc_colors).__name__})")
                            existing_colors = scan_data.get("colors", [])
                            
                            # Ensure both are lists
                            if not isinstance(desc_colors, list):
                                if isinstance(desc_colors, (int, float, str)):
                                    # Convert single value to list
                                    desc_colors = [desc_colors] if isinstance(desc_colors, str) else []
                                else:
                                    desc_colors = []
                            
                            if isinstance(existing_colors, list) and isinstance(desc_colors, list):
                                # Merge and deduplicate colors
                                merged_colors = list(set(existing_colors + desc_colors))[:10]
                                scan_data["colors"] = merged_colors
                            elif isinstance(existing_colors, list):
                                # Use existing colors if desc_colors is invalid
                                scan_data["colors"] = existing_colors
                            elif isinstance(desc_colors, list):
                                # Use desc_colors if existing_colors is invalid
                                scan_data["colors"] = desc_colors[:10]
                        
                        # Enhance structure counts with description context
                        if description_params.get("structure"):
                            desc_structures = description_params["structure"]
                            print(f"[SCAN] Description suggests structures: {desc_structures}")
                            vision_objects = scan_data.get("objects", {})
                            # Merge structure counts intelligently
                            for struct_type, count in desc_structures.items():
                                if isinstance(count, (int, float)) and count > 0:
                                    # Average or take max of vision and description counts
                                    existing_count = vision_objects.get(struct_type, 0)
                                    vision_objects[struct_type] = max(existing_count, int(count))
                            scan_data["objects"] = vision_objects
                        
                        # Store original description for reference
                        scan_data["description"] = description
                        scan_data["enhanced_with_description"] = True
                        print("[SCAN] ✅ Successfully combined OpenAI Vision + Overshoot description")
        
        # FALLBACK: If no image, use streaming description only
        elif request.streaming_analysis and request.use_streaming:
            print("[SCAN] Using streaming analysis only (no image provided)")
            if isinstance(request.streaming_analysis, dict) and request.streaming_analysis.get("type") == "text_description":
                # This is a text description - use it directly as a prompt for world generation
                description = request.streaming_analysis.get("description", "")
                print(f"[SCAN] Received text description: {description[:200]}...")
                
                if description:
                    # Use the description as a prompt - call generate_world internally
                    # This reuses all the existing world generation logic
                    print(f"[SCAN] Using description as prompt for world generation: {description}")
                    
                    # Create a prompt dict and call the generate_world function logic
                    # We'll parse the prompt and generate the world the same way generate-world does
                    parsed_params = parse_prompt(description)
                    
                    biome = parsed_params.get("biome", "default")
                    time_of_day = parsed_params.get("time", "noon")
                    enemy_count = parsed_params.get("enemy_count", 5)
                    structure_counts = parsed_params.get("structure", {})
                    color_palette = parsed_params.get("color_palette", [])
                    
                    # Ensure color_palette is always a list BEFORE using it
                    if not isinstance(color_palette, list):
                        if isinstance(color_palette, str):
                            color_palette = [color_palette]
                        else:
                            color_palette = []
                    
                    # Set up structure counts (same logic as generate_world)
                    if not structure_counts:
                        structure_counts = {}
                    
                    tree_count = structure_counts.get("tree", None)
                    rock_count = structure_counts.get("rock", None)
                    mountain_count = structure_counts.get("mountain", None)
                    building_count = structure_counts.get("building", None)
                    
                    # Apply defaults
                    if tree_count is None:
                        tree_count = 25 if biome.lower() in ["arctic", "winter", "icy"] else 10
                    if rock_count is None:
                        rock_count = 5
                    if mountain_count is None:
                        mountain_count = 1 if biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"] else 0
                    
                    structure_counts["mountain"] = mountain_count
                    structure_counts["tree"] = tree_count
                    structure_counts["rock"] = rock_count
                    if building_count is not None:
                        structure_counts["building"] = building_count
                    
                    # Generate terrain
                    terrain_data = generate_heightmap(biome, structure_counts, color_palette=color_palette)
                    heightmap_raw = terrain_data["heightmap_raw"]
                    placement_mask = terrain_data["placement_mask"]
                    
                    # Assign colors if palette provided
                    color_assignments = {}
                    # Ensure color_palette is a list
                    if not isinstance(color_palette, list):
                        if isinstance(color_palette, str):
                            color_palette = [color_palette]
                        else:
                            color_palette = []
                    if color_palette and len(color_palette) > 0:
                        color_assignments = assign_palette_to_elements(color_palette)
                    
                    # Generate structures (reuse existing functions)
                    trees = generate_trees(heightmap_raw, placement_mask, biome, tree_count, terrain_size=256.0)
                    rocks = generate_rocks(heightmap_raw, biome, rock_count, terrain_size=256.0, placement_mask=placement_mask)
                    peaks = generate_mountain_peaks(heightmap_raw, biome, terrain_size=256.0, max_peaks=mountain_count)
                    
                    structures = {
                        "trees": trees,
                        "rocks": rocks,
                        "peaks": peaks
                    }
                    
                    # Add buildings if needed
                    if building_count and building_count > 0 and biome.lower() == "city":
                        buildings = generate_buildings(heightmap_raw, placement_mask, biome, building_count, terrain_size=256.0)
                        structures["buildings"] = buildings
                    
                    # Generate enemies
                    walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
                    if walkable_points:
                        spawn_x, spawn_z = random.choice(walkable_points)
                        spawn_y = heightmap_raw[int(spawn_z)][int(spawn_x)] * 10
                    else:
                        spawn_x, spawn_z, spawn_y = 0, 0, 5
                    
                    spawn_point = {"x": float(spawn_x), "y": float(spawn_y), "z": float(spawn_z)}
                    enemies = place_enemies(enemy_count, heightmap_raw, placement_mask, terrain_size=256.0, player_spawn=spawn_point)
                    
                    # Generate lighting
                    lighting_preset = get_lighting_preset(biome, time_of_day)
                    sky_color = get_sky_color(biome, time_of_day)
                    lighting_config = {
                        **lighting_preset,
                        "background": sky_color
                    }
                    
                    # Get physics config
                    physics_config = get_combined_config(biome)
                    
                    return {
                        "world": {
                            **terrain_data,
                            "biome": biome,
                            "biome_name": biome,
                            "time": time_of_day,
                            "lighting_config": lighting_config,
                            "color_assignments": color_assignments
                        },
                        "structures": structures,
                        "combat": {
                            "enemies": enemies,
                            "enemy_count": len(enemies)
                        },
                        "physics": physics_config,
                        "spawn_point": spawn_point
                    }
                else:
                    raise HTTPException(status_code=400, detail="Empty description received from streaming analysis")
            
            # Handle structured data (legacy format)
            from world.overshoot_integration import parse_overshoot_response
            
            # If it's already in the format we expect (has biome, objects keys), use directly
            if isinstance(request.streaming_analysis, dict) and "biome" in request.streaming_analysis:
                # Already in our expected format
                scan_data = request.streaming_analysis
            else:
                # Parse it through parse_overshoot_response to normalize format
                scan_data = parse_overshoot_response(request.streaming_analysis)
            
            # Ensure scan_data has correct types (colors must be a list)
            if scan_data and isinstance(scan_data, dict):
                if "colors" in scan_data:
                    colors_raw = scan_data.get("colors", [])
                    if not isinstance(colors_raw, list):
                        if isinstance(colors_raw, str):
                            scan_data["colors"] = [colors_raw]
                        else:
                            scan_data["colors"] = []
                else:
                    scan_data["colors"] = []
                
                # Ensure objects is a dict
                if "objects" not in scan_data or not isinstance(scan_data.get("objects"), dict):
                    scan_data["objects"] = {}
            
            # Then convert to world params using generate_world_from_scan
            # Note: generate_world_from_scan expects parsed format, so scan_data should already be parsed
            print(f"[SCAN] Parsed streaming analysis: biome={scan_data.get('biome')}, objects={scan_data.get('objects')}, colors type={type(scan_data.get('colors')).__name__}")
        else:
            raise HTTPException(status_code=400, detail="Either image_data or streaming_analysis must be provided")
        
        if not scan_data:
            # Check if it's an API key issue
            import os
            api_key = os.getenv("OVERSHOOT_API_KEY")
            api_url = os.getenv("OVERSHOOT_API_URL", "https://cluster1.overshoot.ai/api/v0.2")
            
            if not api_key:
                raise HTTPException(
                    status_code=500, 
                    detail="OVERSHOOT_API_KEY not set in environment. Please add OVERSHOOT_API_KEY to your backend/.env file and restart the server."
                )
            
            # Provide more helpful error message
            error_detail = (
                f"Failed to analyze environment with Vision AI.\n\n"
                f"Check your backend console terminal for detailed error messages.\n\n"
                f"Recommended: Set OPENAI_API_KEY in backend/.env for single image analysis.\n"
                f"Alternative: Set OVERSHOOT_API_KEY (NOTE: Overshoot SDK is for streaming video).\n\n"
                f"Get OpenAI API key: https://platform.openai.com/api-keys"
            )
            raise HTTPException(
                status_code=500, 
                detail=error_detail
            )
        
        # Validate scan_data format
        if not isinstance(scan_data, dict):
            raise HTTPException(status_code=500, detail="Invalid scan data format")
        
        if "biome" not in scan_data or "objects" not in scan_data:
            raise HTTPException(
                status_code=500, 
                detail=f"Invalid scan data: missing required keys. Got: {list(scan_data.keys())}"
            )
        
        print(f"[SCAN] Detected: biome={scan_data['biome']}, objects={scan_data['objects']}")
        
        # Generate world parameters from scan
        world_params = generate_world_from_scan(scan_data)
        
        biome = world_params["biome"]
        time_of_day = world_params["time"]
        enemy_count = world_params["enemy_count"]
        weapon = world_params["weapon"]
        structure_counts = world_params["structure"]
        tree_colors = world_params.get("tree_colors", {})
        
        print(f"[SCAN] World params: biome={biome}, time={time_of_day}, structures={structure_counts}")
        
        # Use existing world generation pipeline
        # Support dynamic biomes from scan data
        scan_color_palette = scan_data.get("colors", [])
        # Ensure color_palette is always a list
        if not isinstance(scan_color_palette, list):
            if isinstance(scan_color_palette, str):
                scan_color_palette = [scan_color_palette]
            else:
                scan_color_palette = []
        terrain_data = generate_heightmap(biome, structure_counts, color_palette=scan_color_palette)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]
        
        terrain_size = 256
        
        # Generate peaks first (they affect tree placement)
        mountain_count = structure_counts.get("mountain", 0)
        peaks = generate_mountain_peaks(heightmap_raw, biome, terrain_size, max_peaks=mountain_count) if mountain_count > 0 else []
        
        # Generate structures with scan-based parameters
        tree_count = structure_counts.get("tree", 10)
        rock_count = structure_counts.get("rock", 5)
        building_count = structure_counts.get("building", 0)
        street_lamp_count = structure_counts.get("street_lamp", 0)
        
        structures = {
            "trees": generate_trees_with_colors(
                heightmap_raw=heightmap_raw,
                placement_mask=placement_mask,
                biome=biome,
                count=tree_count,
                terrain_size=terrain_size,
                leaf_color=tree_colors.get("leaf_color"),
                trunk_color=tree_colors.get("trunk_color"),
                existing_peaks=peaks
            ),
            "rocks": generate_rocks(heightmap_raw, biome, rock_count, terrain_size, placement_mask),
            "peaks": peaks,
            "buildings": generate_buildings(heightmap_raw, placement_mask, biome, building_count, terrain_size),
            "street_lamps": generate_street_lamps(heightmap_raw, placement_mask, biome, street_lamp_count, terrain_size)
        }
        
        # Determine player spawn on a walkable point
        walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
        if not walkable_points:
            raise HTTPException(status_code=500, detail="No valid player spawn points")
        
        spawn_idx_x, spawn_idx_z = random.choice(walkable_points)
        segments = len(heightmap_raw) - 1
        
        spawn_x = (spawn_idx_x / segments) * terrain_size - terrain_size / 2
        spawn_z = (spawn_idx_z / segments) * terrain_size - terrain_size / 2
        spawn_y = heightmap_raw[spawn_idx_z][spawn_idx_x] * 10 + 0.5
        
        spawn_point = {"x": float(spawn_x), "y": float(spawn_y), "z": float(spawn_z)}
        
        # Place enemies
        enemies = place_enemies(
            heightmap_raw=heightmap_raw,
            placement_mask=placement_mask,
            enemy_count=enemy_count,
            player_spawn=spawn_point
        )
        
        # Physics + combat config
        configs = get_combined_config(weapon)
        
        # Lighting and sky (now biome-aware)
        lighting_config = get_lighting_preset(time_of_day, biome)
        sky_colour = get_sky_color(time_of_day, biome)
        
        print(f"[SCAN] Lighting config: {lighting_config}")
        print(f"[SCAN] Sky color: {sky_colour}")
        print("="*60 + "\n")
        
        # Build response
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
        
    except HTTPException:
        # Re-raise HTTPExceptions as-is (they already have proper error messages)
        raise
    except Exception as e:
        error_msg = str(e) if str(e) else f"Unknown error: {type(e).__name__}"
        print(f"[SCAN ERROR] {error_msg}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=error_msg)

class OpenRouterImageAnalysisRequest(BaseModel):
    image_data: str

@router.post("/analyze-image-openrouter")
async def analyze_image_openrouter(request: OpenRouterImageAnalysisRequest) -> Dict:
    """
    Analyze a single image using OpenRouter Vision API.
    Called every 3 seconds while streaming to get periodic snapshots.
    """
    try:
        image_data = request.image_data
        if not image_data:
            raise HTTPException(status_code=400, detail="No image_data provided")
        
        print("[OPENROUTER] Analyzing image (periodic snapshot)...")
        
        # Use the existing analyze_with_openai_vision function
        # It automatically detects OpenRouter API keys
        result = await analyze_with_openai_vision(image_data)
        
        if not result:
            raise HTTPException(status_code=500, detail="Failed to analyze image with OpenRouter Vision")
        
        # Return a simplified description format
        description = result.get("description", "")
        if not description:
            # Try to construct description from result fields
            objects = result.get("objects", {})
            biome = result.get("biome", result.get("terrain", {}).get("type", "unknown"))
            colors = result.get("colors", [])
            
            description = f"A {biome} environment"
            if objects:
                obj_list = ", ".join([f"{count} {obj_type}" for obj_type, count in objects.items() if count > 0])
                if obj_list:
                    description += f" with {obj_list}"
            if colors:
                description += f". Colors: {', '.join(colors[:3])}"
        
        return {
            "description": description,
            "biome": result.get("biome", "unknown"),
            "objects": result.get("objects", {}),
            "colors": result.get("colors", []),
            "timestamp": result.get("timestamp")
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))