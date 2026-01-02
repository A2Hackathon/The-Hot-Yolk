from fastapi import APIRouter, HTTPException
from typing import Dict
import random
from voice.voice import parse_prompt
from world.terrain import generate_heightmap, get_walkable_points
from world.enemy_placer import place_enemies
from world.lighting import get_lighting_preset, get_sky_color
from world.physics_config import get_combined_config

router = APIRouter()

@router.post("/generate-world")
async def generate_world(prompt: Dict) -> Dict:
    try:
        prompt_text = prompt.get("prompt", "")
        if not prompt_text:
            raise HTTPException(status_code=400, detail="No prompt provided")

        # --- Parse prompt ---
        parsed_params = parse_prompt(prompt_text)
        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "dash")
        structure_counts = parsed_params.get("structure", {})

        # --- Generate terrain ---
        terrain_data = generate_heightmap(biome, structure_counts)
        heightmap_raw = terrain_data["heightmap_raw"]
        placement_mask = terrain_data["placement_mask"]

        # --- Determine player spawn on a walkable point ---
        walkable_points = get_walkable_points(placement_mask=placement_mask, radius=1)
        if not walkable_points:
            raise HTTPException(status_code=500, detail="No valid player spawn points")

        # Randomly pick a walkable point
        spawn_idx_x, spawn_idx_z = random.choice(walkable_points)

        # Convert to Three.js world coordinates
        terrain_size = 256  # must match PlaneGeometry size in app.jsx
        segments = len(heightmap_raw) - 1

        spawn_x = (spawn_idx_x / segments) * terrain_size - terrain_size / 2
        spawn_z = (spawn_idx_z / segments) * terrain_size - terrain_size / 2
        spawn_y = heightmap_raw[spawn_idx_z][spawn_idx_x] * 10 + 0.5  # scale + half player height

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
