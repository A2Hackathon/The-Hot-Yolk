from fastapi import APIRouter, HTTPException
from typing import Dict
from ...voice.voice import capture_and_parse_command
from ...world.terrain import generate_heightmap, get_valid_spawn_points
from ...world.enemy_placer import place_enemies
from ...world.lighting import get_lighting_preset, get_sky_color
from ...world.physics_config import get_combined_config

router = APIRouter()

@router.post("/generate-world")
async def generate_world() -> Dict:
    try:
        # Capture and parse voice command
        print("[API] Waiting for voice input...")
        parsed_params = capture_and_parse_command()
        if not parsed_params:
            raise HTTPException(status_code=400, detail="No command detected")

        biome = parsed_params.get("biome", "city")
        time_of_day = parsed_params.get("time", "noon")
        enemy_count = parsed_params.get("enemy_count", 5)
        weapon = parsed_params.get("weapon", "dash")
        structure_counts = parsed_params.get("structure", {})

        print(f"[API] Parsed params: {parsed_params}")

        # Generate terrain
        terrain_data = generate_heightmap(biome, structure_counts)
        spawn_point = get_valid_spawn_points(
            terrain_data["placement_mask"],
            terrain_data["heightmap_raw"]
        )

        # Place enemies
        enemies = place_enemies(
            heightmap_raw=terrain_data["heightmap_raw"],
            placement_mask=terrain_data["placement_mask"],
            enemy_count=enemy_count,
            player_spawn=spawn_point
        )

        # Get physics + combat config
        configs = get_combined_config(weapon)

        # Get lighting and sky
        lighting_config = get_lighting_preset(time_of_day)
        sky_colour = get_sky_color(time_of_day)

        # Build response
        response = {
            "world": {
                "biome": biome,
                "time": time_of_day,
                "heightmap_url": terrain_data["heightmap_url"],
                "texture_url": terrain_data["texture_url"],
                "lighting_config": lighting_config,
                "sky_colour": sky_colour
            },
            "combat": {
                "enemy_count": len(enemies),
                "enemies": enemies,
                "combat_config": configs["combat"]
            },
            "physics": configs["physics"],
            "spawn_point": spawn_point
        }

        print(f"[API] World generated with {len(enemies)} enemies")
        return response

    except Exception as e:
        print(f"[API] Error generating world: {e}")
        raise HTTPException(status_code=500, detail=str(e))
