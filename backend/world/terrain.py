import numpy as np
from noise import snoise2  # Simplex noise
from PIL import Image
import random
import os
import uuid

# Biome settings 
BIOME_SETTINGS = {
    "arctic": {"height_multiplier": 2.0, "ground_color": "snow"},
    "city": {"height_multiplier": 1.0, "ground_color": "street"},
    "default": {"height_multiplier": 1.0, "ground_color": "grass"}
}

GROUND_COLORS = {
    "snow": (255, 255, 255),
    "street": (128, 128, 128),
    "grass": (34, 177, 76)
}

# Structure height multipliers 
STRUCTURE_KEYWORDS = {
    "mountain": 1.5,   # multiplier for extra height
    "hill": 1.2,       # smaller elevation bump
    "river": 0.5       # depress terrain
}

# Placement rules per biome
PLACEMENT_RULES = {
    "arctic": {
        "min_height": 0.3,   # Avoid frozen lakes
        "max_height": 1.2,   # Avoid mountain peaks
        "max_slope": 0.25    # Gentler slopes (ice is slippery)
    },
    "city": {
        "min_height": 0.2,   # Avoid rivers
        "max_height": 0.8,   # Avoid tall buildings
        "max_slope": 0.4     # Steeper slopes OK (stairs/ramps)
    },
    "default": {
        "min_height": 0.2,
        "max_height": 1.0,
        "max_slope": 0.3
    }
}

def get_biome_settings(biome_name, structure_count_dict=None):
    """
    Extract biome settings and return config
    """
    settings = BIOME_SETTINGS.get(biome_name, BIOME_SETTINGS["default"])
    height_multiplier = settings["height_multiplier"]
    ground_color_name = settings["ground_color"]
    ground_rgb = GROUND_COLORS[ground_color_name]
    
    if structure_count_dict is None:
        structure_count_dict = {}
    
    return height_multiplier, ground_rgb, structure_count_dict

def get_colour(ground_rgb):
    """Map height to color with small variation"""
    r, g, b = ground_rgb
    r = max(0, min(255, r + random.randint(-5, 5)))
    g = max(0, min(255, g + random.randint(-5, 5)))
    b = max(0, min(255, b + random.randint(-5, 5)))
    return (r, g, b)

def generate_placement_mask(heightmap, biome_name):
    """
    Generate improved placement mask with height and slope checks
    0 = blocked (water, cliffs, peaks)
    1 = walkable (safe for enemies and player)
    """
    height, width = heightmap.shape
    placement_mask = np.zeros((height, width), dtype=np.uint8)
    
    # Get biome-specific rules
    rules = PLACEMENT_RULES.get(biome_name, PLACEMENT_RULES["default"])
    min_h = rules["min_height"]
    max_h = rules["max_height"]
    max_slope = rules["max_slope"]
    
    # Check each cell (skip edges for slope calculation)
    for y in range(1, height - 1):
        for x in range(1, width - 1):
            h = heightmap[y, x]
            
            # 1. Height range check
            if h < min_h or h > max_h:
                placement_mask[y, x] = 0
                continue
            
            # 2. Slope check (compare with 4 cardinal neighbors)
            neighbors = [
                heightmap[y - 1, x],  # North
                heightmap[y + 1, x],  # South
                heightmap[y, x - 1],  # West
                heightmap[y, x + 1]   # East
            ]
            
            # Calculate maximum slope
            slopes = [abs(h - n) for n in neighbors]
            if max(slopes) > max_slope:
                placement_mask[y, x] = 0  # Too steep
            else:
                placement_mask[y, x] = 1  # Walkable
    
    return placement_mask

def generate_heightmap_data(biome_name, structure_count_dict=None, width=128, height=128, scale=0.15):
    """
    Generate heightmap, colormap, and placement mask
    """
    height_multiplier, ground_rgb, structure_count_dict = get_biome_settings(biome_name, structure_count_dict)
    heightmap = np.zeros((height, width))

    # Base Simplex noise heightmap
    for y in range(height):
        for x in range(width):
            nx = x / width
            ny = y / height
            value = snoise2(nx / scale, ny / scale, octaves=4)
            normalized = (value + 1) / 2 * height_multiplier
            heightmap[y, x] = normalized

    # Apply structure multipliers
    for structure, count in structure_count_dict.items():
        multiplier = STRUCTURE_KEYWORDS.get(structure, 1.0)
        radius = 5  # affect nearby pixels
        for _ in range(count):
            cy = random.randint(0, height - 1)
            cx = random.randint(0, width - 1)
            for y in range(max(0, cy - radius), min(height, cy + radius + 1)):
                for x in range(max(0, cx - radius), min(width, cx + radius + 1)):
                    distance = ((y - cy)**2 + (x - cx)**2)**0.5
                    factor = max(0, 1 - distance / radius)
                    heightmap[y, x] *= 1 + factor * (multiplier - 1)
                    heightmap[y, x] = min(heightmap[y, x], height_multiplier * multiplier)

    # Generate colormap
    colour_map_array = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            colour_map_array[y, x] = get_colour(ground_rgb)

    # Generate improved placement mask
    placement_mask = generate_placement_mask(heightmap, biome_name)
    
    # Calculate walkable percentage for debugging
    walkable_count = np.sum(placement_mask)
    total_cells = placement_mask.size
    walkable_percent = (walkable_count / total_cells) * 100
    print(f"[Terrain] Walkable area: {walkable_percent:.1f}% ({walkable_count}/{total_cells} cells)")

    return heightmap, colour_map_array, placement_mask

def generate_heightmap(biome_name, structures=None):
    """
    Generate and save heightmap PNG, return URLs and placement mask
    """
    heightmap, colour_map_array, placement_mask = generate_heightmap_data(biome_name, structures)
    
    # Create assets directory if it doesn't exist
    os.makedirs("assets/heightmaps", exist_ok=True)
    
    # Save colormap as PNG (for texture)
    img = Image.fromarray(colour_map_array, "RGB")
    texture_filename = f"terrain_{uuid.uuid4().hex[:8]}.png"
    texture_filepath = f"assets/heightmaps/{texture_filename}"
    img.save(texture_filepath)
    
    # Save raw heightmap as grayscale (for Three.js displacement)
    heightmap_normalized = ((heightmap - heightmap.min()) / (heightmap.max() - heightmap.min()) * 255).astype(np.uint8)
    heightmap_img = Image.fromarray(heightmap_normalized, mode='L')
    heightmap_filename = f"heightmap_{uuid.uuid4().hex[:8]}.png"
    heightmap_filepath = f"assets/heightmaps/{heightmap_filename}"
    heightmap_img.save(heightmap_filepath)
    
    return {
        "texture_url": f"/assets/heightmaps/{texture_filename}",
        "heightmap_url": f"/assets/heightmaps/{heightmap_filename}",
        "placement_mask": placement_mask.tolist(),
        "heightmap_raw": heightmap.tolist()  # For enemy Y positioning
    }

def save_heightmap_png(prompt_parser_response, filename="assets/heightmaps/terrain.png"):
    """
    Legacy function for backward compatibility
    Accepts old format with biome as list
    """
    biome_name = prompt_parser_response["biome"][0] if isinstance(prompt_parser_response["biome"], list) else prompt_parser_response["biome"]
    structure_count_dict = prompt_parser_response.get("structure", {})
    
    _, colour_map_array, _ = generate_heightmap_data(biome_name, structure_count_dict)
    img = Image.fromarray(colour_map_array, "RGB")
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    img.save(filename)
    print(f"Terrain saved as {filename}")


def get_valid_spawn_points(placement_mask, heightmap_raw, radius=5):
    """
    Returns a valid spawn point from the placement mask
    Args:
        placement_mask: 2D list of 0/1
        heightmap_raw: 2D list of heights
        radius: min distance from map edges
    Returns:
        dict with x, y, z
    """
    height = len(placement_mask)
    width = len(placement_mask[0])
    candidates = []

    # Avoid edges and pick walkable points
    for z in range(radius, height - radius):
        for x in range(radius, width - radius):
            if placement_mask[z][x] == 1:
                candidates.append((x, z))

    if not candidates:
        # Fallback: center
        x = width // 2
        z = height // 2
    else:
        x, z = random.choice(candidates)

    y = heightmap_raw[z][x] + 0.5  # add player height offset
    return {"x": float(x), "y": float(y), "z": float(z)}