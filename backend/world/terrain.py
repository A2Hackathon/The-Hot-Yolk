import numpy as np
from noise import snoise2
from PIL import Image
import random
import os
import uuid

# Biome settings 
BIOME_SETTINGS = {
    "arctic": {"height_multiplier": 1.0, "ground_color": "snow"},
    "city": {"height_multiplier": 1.0, "ground_color": "street"},
    "default": {"height_multiplier": 1.0, "ground_color": "grass"}
}

GROUND_COLORS = {
    "snow": (245, 245, 245),
    "street": (253, 228, 172),
    "grass": (34, 177, 76)
}

# Arctic altitude-based snow colours
ARCTIC_SNOW = {
    "low": (255, 255, 255) ,   # blue-grey ice
    "mid":  (255, 255, 255),   # clean snow
    "high": (255, 255, 255)   # pure white peaks
}


# Structure multipliers
STRUCTURE_KEYWORDS = {
    "mountain": 1.5,
    "hill": 1.2,
    "river": 0.5  # river depresses terrain
}

PLACEMENT_RULES = {
    "arctic": {"min_height": 0.3, "max_height": 1.2, "max_slope": 0.25},
    "city": {"min_height": 0.2, "max_height": 0.8, "max_slope": 0.4},
    "default": {"min_height": 0.2, "max_height": 1.0, "max_slope": 0.3}
}

# ---------------- Helpers ----------------
def get_biome_settings(biome_name, structure_count_dict=None):
    settings = BIOME_SETTINGS.get(biome_name, BIOME_SETTINGS["default"])
    height_multiplier = settings["height_multiplier"]
    ground_rgb = GROUND_COLORS[settings["ground_color"]]
    if structure_count_dict is None:
        structure_count_dict = {}
    return height_multiplier, ground_rgb, structure_count_dict

def get_colour(ground_rgb):
    r, g, b = ground_rgb
    r = max(0, min(255, r + random.randint(-2, 3)))
    g = max(0, min(255, g + random.randint(-2, 3)))
    b = max(0, min(255, b + random.randint(-2, 3)))
    return (r, g, b)

def get_arctic_snow_colour(height, max_height):
    ratio = height / max_height

    if ratio > 0.75:
        base = ARCTIC_SNOW["high"]
    elif ratio > 0.45:
        base = ARCTIC_SNOW["mid"]
    else:
        base = ARCTIC_SNOW["low"]

    return get_colour(base)

def generate_placement_mask(heightmap, biome_name):
    h, w = heightmap.shape
    mask = np.zeros((h, w), dtype=np.uint8)
    rules = PLACEMENT_RULES.get(biome_name, PLACEMENT_RULES["default"])
    min_h, max_h, max_slope = rules["min_height"], rules["max_height"], rules["max_slope"]

    for y in range(1, h-1):
        for x in range(1, w-1):
            val = heightmap[y, x]
            if val < min_h or val > max_h:
                mask[y, x] = 0
                continue
            neighbors = [heightmap[y-1,x], heightmap[y+1,x], heightmap[y,x-1], heightmap[y,x+1]]
            slopes = [abs(val - n) for n in neighbors]
            mask[y, x] = 1 if max(slopes) <= max_slope else 0
    return mask

# ---------------- Core Generation ----------------
def generate_heightmap_data(biome_name, structure_count_dict=None, width=256, height=256, scale=0.3):
    height_multiplier, ground_rgb, structure_count_dict = get_biome_settings(biome_name, structure_count_dict)
    heightmap = np.zeros((height, width))

    # Base Simplex noise
    for y in range(height):
        for x in range(width):
            nx, ny = x / width, y / height
            if biome_name == "city":
            # Low-frequency, low-detail noise = flatter terrain
                val = snoise2(
                    nx / (scale * 3),
                    ny / (scale * 3),
                    octaves=1
            )
            else:
                val = snoise2(
                    nx / scale,
                    ny / scale,
                    octaves=4
            )
            heightmap[y, x] = (val + 1) / 2 * height_multiplier

    # Masks
    river_mask = np.zeros((height, width), dtype=bool)
    mountain_mask = np.zeros((height, width), dtype=bool)

    # Track placed tree positions
    placed_tree_positions = []

    # Apply structures
    for structure, count in structure_count_dict.items():
        multiplier = STRUCTURE_KEYWORDS.get(structure, 1.0)
        radius = 5  # general radius for terrain deformation
        for _ in range(count):
            # Attempt placement multiple times if colliding
            for attempt in range(20):
                cx, cy = random.randint(0, width-1), random.randint(0, height-1)

                # Check terrain collision for mountains/rivers
                if structure == "river":
                    for y2 in range(max(0, cy-radius), min(height, cy+radius+1)):
                        for x2 in range(max(0, cx-radius), min(width, cx+radius+1)):
                            dist = np.sqrt((y2-cy)**2 + (x2-cx)**2)
                            factor = max(0, 1 - dist / radius)
                            heightmap[y2, x2] *= 1 - factor * 0.6
                            river_mask[y2, x2] = True
                    break

                # For mountains/hills
                else:
                    # Check tree collision for trees
                    tree_radius = 3  # approx trunk radius in cells
                    too_close = any(np.sqrt((cx - px)**2 + (cy - py)**2) < tree_radius for px, py in placed_tree_positions)
                    if too_close:
                        continue  # retry placement

                    # If passed collision check, place it
                    placed_tree_positions.append((cx, cy))

                    for y2 in range(max(0, cy-radius), min(height, cy+radius+1)):
                        for x2 in range(max(0, cx-radius), min(width, cx+radius+1)):
                            dist = np.sqrt((y2-cy)**2 + (x2-cx)**2)
                            factor = max(0, 1 - dist / radius)
                            heightmap[y2, x2] *= 1 + factor * (multiplier - 1)
                            heightmap[y2, x2] = min(heightmap[y2, x2], height_multiplier * multiplier)
                            if structure == "mountain":
                                mountain_mask[y2, x2] = True
                    break  # exit retry loop once placed

    placement_mask = generate_placement_mask(heightmap, biome_name)

    # Colour map
    colour_map_array = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            if river_mask[y, x]:
                colour_map_array[y, x] = (0, 120, 255)
            elif biome_name == "arctic":
                colour_map_array[y, x] = get_arctic_snow_colour(
                    heightmap[y, x],
                    height_multiplier * 1.5
                )
            elif mountain_mask[y, x]:
                colour_map_array[y, x] = (120, 120, 120)
            else:
                colour_map_array[y, x] = get_colour(ground_rgb)

    walkable_count = np.sum(placement_mask)
    print(f"[Terrain] Walkable area: {walkable_count / placement_mask.size * 100:.1f}%")
    print(f"[Terrain] Trees placed: {len(placed_tree_positions)}")

    return heightmap, colour_map_array, placement_mask, placed_tree_positions

# ---------------- Save and Export ----------------
def generate_heightmap(biome_name, structures=None):
    heightmap, colour_map_array, placement_mask, placed_tree_positions = generate_heightmap_data(biome_name, structures)

    os.makedirs("assets/heightmaps", exist_ok=True)

    img = Image.fromarray(colour_map_array, "RGB")
    texture_filename = f"terrain_{uuid.uuid4().hex[:8]}.png"
    texture_filepath = f"assets/heightmaps/{texture_filename}"
    img.save(texture_filepath)

    heightmap_norm = ((heightmap - heightmap.min()) / (heightmap.max() - heightmap.min()) * 255).astype(np.uint8)
    heightmap_img = Image.fromarray(heightmap_norm, mode='L')
    heightmap_filename = f"heightmap_{uuid.uuid4().hex[:8]}.png"
    heightmap_filepath = f"assets/heightmaps/{heightmap_filename}"
    heightmap_img.save(heightmap_filepath)

    return {
        "texture_url": f"/assets/heightmaps/{texture_filename}",
        "heightmap_url": f"/assets/heightmaps/{heightmap_filename}",
        "placement_mask": placement_mask.tolist(),
        "heightmap_raw": heightmap.tolist(),
        "colour_map_array": colour_map_array.tolist(),
        "placed_tree_positions": placed_tree_positions 
    }

def save_heightmap_png(prompt_parser_response, filename="assets/heightmaps/terrain.png"):
    biome_name = prompt_parser_response.get("biome", "default")
    structure_count_dict = prompt_parser_response.get("structure", {})
    _, colour_map_array, _ = generate_heightmap_data(biome_name, structure_count_dict)
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    Image.fromarray(colour_map_array, "RGB").save(filename)
    print(f"Terrain saved as {filename}")

def get_walkable_points(placement_mask, radius=1):
    h, w = len(placement_mask), len(placement_mask[0])
    points = []
    for z in range(radius, h-radius):
        for x in range(radius, w-radius):
            if placement_mask[z][x] == 1:
                points.append((x, z))
    return points
