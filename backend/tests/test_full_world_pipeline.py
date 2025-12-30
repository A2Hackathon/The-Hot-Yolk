# backend/tests/test_full_world_pipeline.py
import sys
import os
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from world.prompt_parser import parse_prompt
from world.terrain import generate_heightmap, get_walkable_points
from world.enemy_placer import place_enemies
from world.lighting import get_lighting_preset, interpolate_lighting
from world.physics_config import get_combined_config, modify_physics
import random


def test_full_world_pipeline():
    print("=== FULL WORLD PIPELINE TEST ===")

    # 1. Parse prompt
    prompt = "an icy city at sunset with six enemies and only fists"
    parsed = parse_prompt(prompt)

    assert isinstance(parsed, dict)
    print("[✓] Prompt parsed:", parsed)

    # 2. Generate terrain
    terrain = generate_heightmap(
        parsed["biome"],
        parsed.get("structure", {})
    )

    heightmap = terrain["heightmap_raw"]
    placement_mask = terrain["placement_mask"]

    assert len(heightmap) == len(placement_mask)
    assert len(heightmap[0]) == len(placement_mask[0])

    print("[✓] Terrain generated")

    # 3. Get a valid player spawn point
    walkable_points = get_walkable_points(
        placement_mask=placement_mask,
        radius=1
    )

    assert walkable_points, "No walkable points found for player spawn!"

    # Choose a random walkable point as player spawn
    spawn_x, spawn_z = random.choice(walkable_points)
    spawn_y = heightmap[spawn_z][spawn_x]

    spawn = {"x": float(spawn_x), "y": float(spawn_y), "z": float(spawn_z)}
    print("[✓] Player spawn:", spawn)

    # 4. Place enemies
    enemies = place_enemies(
        heightmap_raw=heightmap,
        placement_mask=placement_mask,
        enemy_count=parsed["enemy_count"],
        player_spawn=spawn
    )

    assert len(enemies) == parsed["enemy_count"], f"Expected {parsed['enemy_count']} enemies, got {len(enemies)}"
    print(f"[✓] {len(enemies)} enemies placed")

    # Validate enemy structure
    for enemy in enemies:
        pos = enemy.get("position", {})
        assert all(k in pos for k in ("x", "y", "z")), f"Enemy missing position keys: {enemy}"
        assert "health" in enemy, f"Enemy missing health: {enemy}"

    # 5. Lighting presets
    sunset = get_lighting_preset("sunset")
    night = get_lighting_preset("night")

    assert sunset != night
    print("[✓] Lighting presets valid")

    # 6. Lighting interpolation
    interpolated = interpolate_lighting(
        from_time="sunset",
        to_time="night",
        progress=0.5
    )

    assert isinstance(interpolated, dict)
    print("[✓] Lighting interpolation works")

    # 7. Physics & combat config
    configs = get_combined_config(parsed["weapon"])

    assert "physics" in configs
    assert "combat" in configs
    print("[✓] Physics & combat config loaded")

    # 8. Modify physics live
    modified_physics = modify_physics(
        configs["physics"],
        "make the player jump higher and move faster"
    )

    assert modified_physics != configs["physics"]
    print("[✓] Physics modification works")

    print("\n✅ FULL WORLD PIPELINE PASSED")


if __name__ == "__main__":
    test_full_world_pipeline()
