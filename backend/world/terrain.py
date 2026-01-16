import numpy as np
from noise import snoise2
from PIL import Image
import random
import os
import uuid
import json
import hashlib
import colorsys

# Biome settings 
BIOME_SETTINGS = {
    "arctic": {"height_multiplier": 1.0, "ground_color": "snow"},
    "city": {"height_multiplier": 1.0, "ground_color": "street"},
    "default": {"height_multiplier": 1.0, "ground_color": "grass"}
}

GROUND_COLORS = {
    "snow": (245, 245, 245),
    "street": (220, 200, 230),  # Light purple-grey for city terrain
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
def get_biome_settings(biome_name, structure_count_dict=None, color_palette=None):
    """
    Get biome settings with dynamic support for ANY biome.
    Falls back to default if biome not found, and can use custom color palette.
    """
    # Safety: ensure biome is a string
    if not biome_name or not isinstance(biome_name, str):
        biome_name = "default"
    
    biome_lower = biome_name.lower()
    
    # If we have a custom color palette, use it
    if color_palette and len(color_palette) > 0:
        try:
            # Convert hex to RGB
            rgb_colors = []
            for hex_color in color_palette:
                hex_color = hex_color.lstrip('#')
                rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                rgb_colors.append(rgb)
            
            # Use first color as ground color
            ground_rgb = rgb_colors[0]
            height_multiplier = 1.0
            
            if structure_count_dict is None:
                structure_count_dict = {}
            
            print(f"[TERRAIN] Using custom color palette for '{biome_name}': {color_palette}")
            return height_multiplier, ground_rgb, structure_count_dict
        except Exception as e:
            print(f"[TERRAIN] Error parsing color palette: {e}, using defaults")
    
    # Check predefined biomes
    settings = BIOME_SETTINGS.get(biome_lower, BIOME_SETTINGS["default"])
    height_multiplier = settings["height_multiplier"]
    ground_color_key = settings["ground_color"]
    
    # If biome not in predefined, generate dynamic ground color
    if biome_lower not in BIOME_SETTINGS:
        print(f"[TERRAIN] Unknown biome '{biome_name}', generating dynamic color...")
        ground_rgb = _generate_dynamic_biome_color(biome_name)
    else:
        ground_rgb = GROUND_COLORS.get(ground_color_key, GROUND_COLORS["grass"])
    
    if structure_count_dict is None:
        structure_count_dict = {}
    return height_multiplier, ground_rgb, structure_count_dict


def _generate_dynamic_biome_color(biome_name: str) -> tuple:
    """
    Generate a deterministic color based on biome name hash.
    Ensures same biome name always gets same color.
    """
    # Use hash for consistent color generation
    seed = int(hashlib.md5(biome_name.encode()).hexdigest(), 16) % 10000
    random.seed(seed)
    
    # Generate a coherent color based on biome name
    # Use HSV to create pleasing colors
    base_hue = (seed % 360) / 360.0
    saturation = 0.5 + (seed % 50) / 100.0  # 0.5-1.0
    value = 0.4 + (seed % 40) / 100.0  # 0.4-0.8
    
    rgb = colorsys.hsv_to_rgb(base_hue, saturation, value)
    color = tuple(int(c * 255) for c in rgb)
    
    print(f"[TERRAIN] Generated color for '{biome_name}': RGB{color}")
    return color

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
def generate_heightmap_data(biome_name, structure_count_dict=None, width=256, height=256, scale=0.3, color_palette=None):
    """
    Generate heightmap with dynamic biome support.
    UNIVERSAL: Works for ANY biome type, NEVER fails.
    
    Args:
        biome_name: Any biome name
        structure_count_dict: Structure counts
        width: Heightmap width
        height: Heightmap height
        scale: Terrain scale
        color_palette: Optional list of hex colors for custom biomes
    """
    height_multiplier, ground_rgb, structure_count_dict = get_biome_settings(biome_name, structure_count_dict, color_palette)
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
    
    # Exclude mountain areas from placement mask (no trees/structures on mountains)
    for y in range(height):
        for x in range(width):
            if mountain_mask[y, x]:
                placement_mask[y, x] = 0

    # Colour map
    colour_map_array = np.zeros((height, width, 3), dtype=np.uint8)
    
    # If we have a custom color palette, prepare RGB colors
    palette_rgb = None
    if color_palette and len(color_palette) > 0:
        try:
            palette_rgb = []
            for hex_color in color_palette:
                hex_color = hex_color.lstrip('#')
                rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
                palette_rgb.append(rgb)
            print(f"[TERRAIN] ✅ Using color palette for terrain: {len(palette_rgb)} colors - {color_palette}")
        except Exception as e:
            print(f"[TERRAIN] Error parsing color palette: {e}, using ground_rgb")
            palette_rgb = None
    
    for y in range(height):
        for x in range(width):
            if river_mask[y, x]:
                colour_map_array[y, x] = (0, 120, 255)
            elif biome_name == "arctic":
                # All terrain (including mountains) should be white snow in arctic
                colour_map_array[y, x] = get_arctic_snow_colour(
                    heightmap[y, x],
                    height_multiplier * 1.5
                )
            elif mountain_mask[y, x]:
                colour_map_array[y, x] = (120, 120, 120)
            elif palette_rgb and len(palette_rgb) > 0:
                # Use palette colors (even if just 1 color, use it)
                if len(palette_rgb) == 1:
                    # Single color - use it directly
                    final_color = np.array(palette_rgb[0])
                    variation = np.random.randint(-3, 3, 3)
                    final_color = np.clip(final_color.astype(int) + variation, 0, 255).astype(np.uint8)
                    colour_map_array[y, x] = tuple(final_color)
                else:
                    # Multiple colors - interpolate between palette colors based on height
                    h = heightmap[y, x] / max(0.001, heightmap.max())
                    h = max(0, min(1, h))  # Clamp to [0, 1]
                    
                    # Map height to color index
                    color_idx = h * (len(palette_rgb) - 1)
                    idx1 = int(color_idx)
                    idx2 = min(idx1 + 1, len(palette_rgb) - 1)
                    t = color_idx - idx1
                    
                    # Interpolate between two colors
                    c1 = np.array(palette_rgb[idx1])
                    c2 = np.array(palette_rgb[idx2])
                    final_color = (c1 * (1 - t) + c2 * t).astype(np.uint8)
                    
                    # Add slight variation
                    variation = np.random.randint(-5, 5, 3)
                    final_color = np.clip(final_color.astype(int) + variation, 0, 255).astype(np.uint8)
                    colour_map_array[y, x] = tuple(final_color)
            else:
                colour_map_array[y, x] = get_colour(ground_rgb)

    walkable_count = np.sum(placement_mask)
    print(f"[Terrain] Walkable area: {walkable_count / placement_mask.size * 100:.1f}%")
    print(f"[Terrain] Trees placed: {len(placed_tree_positions)}")

    return heightmap, colour_map_array, placement_mask, placed_tree_positions

# ---------------- Save and Export ----------------
def generate_heightmap(biome_name, structures=None, color_palette=None):
    """
    Generate heightmap with dynamic biome support.
    UNIVERSAL: Works for ANY biome type, NEVER fails.
    
    Args:
        biome_name: Any biome name (predefined or custom)
        structures: Structure count dict
        color_palette: Optional list of hex colors for custom biomes
    """
    heightmap, colour_map_array, placement_mask, placed_tree_positions = generate_heightmap_data(
        biome_name, structures, color_palette=color_palette
    )

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
