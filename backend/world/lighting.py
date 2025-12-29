"""
Lighting configuration presets for different times of day
Returns Three.js-compatible lighting parameters
"""

def get_lighting_preset(time: str) -> dict:
    """
    Return lighting configuration for Three.js based on time of day
    
    Args:
        time: "noon", "sunset", or "night"
    
    Returns:
        dict with ambient, directional, and fog settings
    """
    
    presets = {
        "noon": {
            "ambient": {
                "color": "#ffffff",
                "intensity": 0.6
            },
            "directional": {
                "color": "#ffffff",
                "intensity": 1.0,
                "position": {"x": 50, "y": 100, "z": 50}
            },
            "fog": {
                "color": "#87CEEB",  # Sky blue
                "near": 50,
                "far": 200
            },
            "background": "#87CEEB"
        },
        
        "sunset": {
            "ambient": {
                "color": "#ffb380",  # Soft peachy orange
                "intensity": 0.5
            },
            "directional": {
                "color": "#ffa366",  # Gentle warm orange
                "intensity": 0.9,
                "position": {"x": 100, "y": 20, "z": 50}  # Low sun angle
            },
            "fog": {
                "color": "#d9a066",  # Muted golden orange
                "near": 30,
                "far": 150
            },
            "background": "#d9a066"
        },
        
        "night": {
            "ambient": {
                "color": "#4444ff",  # Cool blue
                "intensity": 0.2
            },
            "directional": {
                "color": "#6666ff",  # Moonlight blue
                "intensity": 0.3,
                "position": {"x": 50, "y": 80, "z": 50}
            },
            "fog": {
                "color": "#001133",  # Dark blue
                "near": 20,
                "far": 100
            },
            "background": "#001133"
        }
    }
    
    # Return preset or default to noon if invalid time
    return presets.get(time, presets["noon"])


def get_sky_color(time: str) -> str:
    """
    Get background/sky color for a given time
    
    Args:
        time: "noon", "sunset", or "night"
    
    Returns:
        Hex color string
    """
    colors = {
        "noon": "#87CEEB",    # Sky blue
        "sunset": "#d9a066",  # Muted golden orange
        "night": "#001133"    # Dark blue
    }
    return colors.get(time, colors["noon"])


def interpolate_lighting(from_time: str, to_time: str, progress: float) -> dict:
    """
    Smoothly transition between two lighting presets
    Useful for live time-of-day changes
    
    Args:
        from_time: Starting time preset
        to_time: Target time preset
        progress: 0.0 to 1.0 (0 = from_time, 1 = to_time)
    
    Returns:
        Interpolated lighting config
    """
    from_preset = get_lighting_preset(from_time)
    to_preset = get_lighting_preset(to_time)
    
    def lerp(a: float, b: float, t: float) -> float:
        """Linear interpolation"""
        return a + (b - a) * t
    
    def lerp_color(c1: str, c2: str, t: float) -> str:
        """Interpolate between two hex colors"""
        r1, g1, b1 = int(c1[1:3], 16), int(c1[3:5], 16), int(c1[5:7], 16)
        r2, g2, b2 = int(c2[1:3], 16), int(c2[3:5], 16), int(c2[5:7], 16)
        
        r = int(lerp(r1, r2, t))
        g = int(lerp(g1, g2, t))
        b = int(lerp(b1, b2, t))
        
        return f"#{r:02x}{g:02x}{b:02x}"
    
    return {
        "ambient": {
            "color": lerp_color(from_preset["ambient"]["color"], to_preset["ambient"]["color"], progress),
            "intensity": lerp(from_preset["ambient"]["intensity"], to_preset["ambient"]["intensity"], progress)
        },
        "directional": {
            "color": lerp_color(from_preset["directional"]["color"], to_preset["directional"]["color"], progress),
            "intensity": lerp(from_preset["directional"]["intensity"], to_preset["directional"]["intensity"], progress),
            "position": {
                "x": lerp(from_preset["directional"]["position"]["x"], to_preset["directional"]["position"]["x"], progress),
                "y": lerp(from_preset["directional"]["position"]["y"], to_preset["directional"]["position"]["y"], progress),
                "z": lerp(from_preset["directional"]["position"]["z"], to_preset["directional"]["position"]["z"], progress)
            }
        },
        "fog": {
            "color": lerp_color(from_preset["fog"]["color"], to_preset["fog"]["color"], progress),
            "near": lerp(from_preset["fog"]["near"], to_preset["fog"]["near"], progress),
            "far": lerp(from_preset["fog"]["far"], to_preset["fog"]["far"], progress)
        },
        "background": lerp_color(from_preset["background"], to_preset["background"], progress)
    }


# Example usage
if __name__ == "__main__":
    import json
    
    print("=== Lighting Presets ===\n")
    
    for time in ["noon", "sunset", "night"]:
        preset = get_lighting_preset(time)
        print(f"{time.upper()}:")
        print(json.dumps(preset, indent=2))
        print()
    
    print("\n=== Interpolation Test (Noon → Sunset at 50%) ===")
    interpolated = interpolate_lighting("noon", "sunset", 0.5)
    print(json.dumps(interpolated, indent=2))