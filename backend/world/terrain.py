import numpy as np
from noise import snoise2
from PIL import Image
import random
import os
import uuid
import json
import hashlib
import colorsys
from typing import Optional, Dict

# Biome settings 
BIOME_SETTINGS = {
    "arctic": {"height_multiplier": 1.0, "ground_color": "snow"},
    "park": {"height_multiplier": 1.0, "ground_color": "snow"},  # Park biome (copy of arctic)
    "city": {"height_multiplier": 1.0, "ground_color": "street"},
    "lava": {"height_multiplier": 1.2, "ground_color": "lava"},
    "volcanic": {"height_multiplier": 1.2, "ground_color": "lava"},
    "volcano": {"height_multiplier": 1.2, "ground_color": "lava"},
    "default": {"height_multiplier": 1.0, "ground_color": "grass"}
}

GROUND_COLORS = {
    "snow": (245, 245, 245),
    "street": (220, 200, 230),  # Light purple-grey for city terrain
    "lava": (139, 0, 0),  # Dark red for lava terrain
    "grass": (34, 177, 76)
}

# Arctic altitude-based snow colours
ARCTIC_SNOW = {
    "low": (200, 230, 255),   # Light sky blue (ground level/cave floor)
    "mid": (150, 200, 255),   # Medium bright blue (cave walls)
    "high": (100, 150, 255)   # Vibrant electric blue (cave ceiling/high areas)
}


# Structure multipliers
STRUCTURE_KEYWORDS = {
    "mountain": 1.5,
    "hill": 1.2,
    "river": 0.5  # river depresses terrain
}

PLACEMENT_RULES = {
    "arctic": {"min_height": 0.2, "max_height": 1.0, "max_slope": 0.3},  # Standard terrain (cave features removed)
    "park": {"min_height": 0.2, "max_height": 1.0, "max_slope": 0.3},  # Park biome (copy of arctic)
    "city": {"min_height": 0.2, "max_height": 0.8, "max_slope": 0.4},
    "lava": {"min_height": 0.3, "max_height": 1.5, "max_slope": 0.5},  # Lava can have more extreme terrain
    "volcanic": {"min_height": 0.3, "max_height": 1.5, "max_slope": 0.5},
    "volcano": {"min_height": 0.3, "max_height": 1.5, "max_slope": 0.5},
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
    # Ensure color_palette is a list before checking length
    if color_palette and isinstance(color_palette, list) and len(color_palette) > 0:
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
def generate_heightmap_data(biome_name, structure_count_dict=None, width=256, height=256, scale=0.3, color_palette=None, color_assignments=None):
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
    
    # Check biome type for special handling
    biome_lower = biome_name.lower() if biome_name else ""
    is_arctic = biome_lower in ["arctic", "winter", "icy", "snow", "frozen", "park"]

    # Standard terrain generation for all biomes (removed cave features for arctic)
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
    
    # Generate mountains directly in the terrain mesh (instead of separate cone structures)
    # For all biomes (including arctic - arctic gets 1 huge mountain)
    if structure_count_dict and structure_count_dict.get("mountain", 0) > 0:
        mountain_count = structure_count_dict.get("mountain", 0)
        print(f"[TERRAIN] Generating {mountain_count} mountains directly in terrain mesh")
        
        placed_mountains = []
        min_mountain_distance = width * 0.15  # Minimum distance between mountains
        
        for _ in range(mountain_count):
            # Try to place mountain
            for attempt in range(50):
                # Random position
                mx = random.randint(int(width * 0.1), int(width * 0.9))
                my = random.randint(int(height * 0.1), int(height * 0.9))
                
                # Check distance from other mountains
                too_close = False
                for pmx, pmy in placed_mountains:
                    dist = np.sqrt((mx - pmx)**2 + (my - pmy)**2)
                    if dist < min_mountain_distance:
                        too_close = True
                        break
                
                if too_close:
                    continue
                
                # Place mountain - create a cone-shaped elevation
                # Arctic gets TALL mountains, others get normal size
                if is_arctic:
                    # TALL mountain for arctic: massive radius and VERY TALL height
                    mountain_radius = random.randint(60, 80)  # HUGE radius (60-80 cells = ~60-80 units)
                    mountain_height = random.uniform(8.0, 12.0)  # VERY TALL height (becomes 80-120 units when *10)
                    print(f"[TERRAIN] Creating TALL arctic mountain: radius={mountain_radius}, height={mountain_height:.2f} (={mountain_height*10:.0f} units)")
                else:
                    # Normal mountains for other biomes
                    mountain_radius = random.randint(15, 25)  # Radius in cells
                    mountain_height = random.uniform(1.5, 2.5)  # Height multiplier (becomes 15-25 units when *10)
                
                # Create mountain cone - steep for arctic, smooth for others
                for y in range(max(0, my - mountain_radius), min(height, my + mountain_radius + 1)):
                    for x in range(max(0, mx - mountain_radius), min(width, mx + mountain_radius + 1)):
                        dist = np.sqrt((x - mx)**2 + (y - my)**2)
                        if dist <= mountain_radius:
                            # Calculate falloff factor based on distance
                            factor = 1.0 - (dist / mountain_radius)
                            
                            # Arctic mountains: STEEP cone (sharp peak)
                            # Others: Smooth cone
                            if is_arctic:
                                # Use exponential falloff for STEEP, dramatic peak
                                # factor^4 creates very steep sides (almost vertical near base)
                                factor = factor ** 4.0  # Very steep falloff for sharp peak
                            else:
                                # Smooth cone shape for other biomes
                                factor = factor ** 1.5  # Smooth falloff
                            
                            elevation = mountain_height * factor
                            
                            # Add to existing height
                            heightmap[y, x] += elevation
                            # Much higher cap for arctic TALL mountains
                            max_height = 15.0 if is_arctic else 3.0  # 150 units for arctic (VERY TALL), 30 for others
                            heightmap[y, x] = min(heightmap[y, x], max_height)
                            
                            # Mark as mountain for coloring
                            mountain_mask[y, x] = True
                
                placed_mountains.append((mx, my))
                print(f"[TERRAIN] Placed mountain at ({mx}, {my}) with radius {mountain_radius}, height {mountain_height:.2f}")
                break

    # Track placed tree positions
    placed_tree_positions = []

    # Apply structures (mountains are handled separately above, skip them here)
    for structure, count in structure_count_dict.items():
        # Skip mountains - they're generated directly in terrain mesh above
        if structure == "mountain":
            continue
            
        multiplier = STRUCTURE_KEYWORDS.get(structure, 1.0)
        radius = 5  # general radius for terrain deformation
        for _ in range(count):
            # Attempt placement multiple times if colliding
            for attempt in range(20):
                cx, cy = random.randint(0, width-1), random.randint(0, height-1)

                # Check terrain collision for rivers
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
    # Ensure color_palette is a list before checking length
    if color_palette and isinstance(color_palette, list) and len(color_palette) > 0:
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
            elif palette_rgb and len(palette_rgb) > 0:
                # PRIORITY: If custom palette is provided, use it (overrides biome defaults)
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
            elif biome_name in ["arctic", "park"]:
                # All terrain (including mountains) should be white snow in arctic (only if no custom palette)
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