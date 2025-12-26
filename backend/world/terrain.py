import numpy as np
from noise import snoise2  # Simplex noise
from PIL import Image
import random

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

# Biome & structure settings from parser response 
def get_biome_settings(prompt_parser_response):
    # Use first biome or default
    biome_name = prompt_parser_response["biome"][0]
    settings = BIOME_SETTINGS.get(biome_name, BIOME_SETTINGS["default"])
    height_multiplier = settings["height_multiplier"]
    ground_color_name = settings["ground_color"]
    ground_rgb = GROUND_COLORS[ground_color_name]

    structure_count_dict = prompt_parser_response.get("structure", {})
    return height_multiplier, ground_rgb, structure_count_dict

#  Map height to color with small variation 
def get_colour(ground_rgb):
    r, g, b = ground_rgb
    r = max(0, min(255, r + random.randint(-5, 5)))
    g = max(0, min(255, g + random.randint(-5, 5)))
    b = max(0, min(255, b + random.randint(-5, 5)))
    return (r, g, b)

# Generate heightmap and apply structure multipliers 
def generate_heightmap(prompt_parser_response, width=128, height=128, scale=0.15):
    height_multiplier, ground_rgb, structure_count_dict = get_biome_settings(prompt_parser_response)
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
            cy = random.randint(0, height-1)
            cx = random.randint(0, width-1)
            for y in range(max(0, cy-radius), min(height, cy+radius+1)):
                for x in range(max(0, cx-radius), min(width, cx+radius+1)):
                    distance = ((y-cy)**2 + (x-cx)**2)**0.5
                    factor = max(0, 1 - distance / radius)
                    heightmap[y, x] *= 1 + factor * (multiplier - 1)
                    heightmap[y, x] = min(heightmap[y, x], height_multiplier * multiplier) # not to tall now hehe

    # Map heightmap to colors
    colour_map_array = np.zeros((height, width, 3), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            colour_map_array[y, x] = get_colour(ground_rgb)

    # Placement mask: 1 = free, 0 = blocked (water or mountain)
    placement_mask = np.ones((height, width), dtype=np.uint8)
    for y in range(height):
        for x in range(width):
            placement_mask[y, x] = 0 if heightmap[y, x] < 0.2 else 1


    return heightmap, colour_map_array, placement_mask

# --- Save terrain as PNG ---
def save_heightmap_png(prompt_parser_response, filename="/backend/assets/heightmaps/terrain.png"):
    _, colour_map_array, _ = generate_heightmap(prompt_parser_response)
    img = Image.fromarray(colour_map_array, "RGB")
    img.save(filename)
    print(f"Terrain saved as {filename}")

# Example usage 
if __name__ == "__main__":
    # Example prompt parser response
    parser_response = {
        "biome": ["arctic"],
        "structure": {"mountain": 3, "hill": 2, "river": 1}
    }
    save_heightmap_png(parser_response)
