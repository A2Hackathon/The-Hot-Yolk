"""
Lighting configuration presets for different times of day and biomes
Returns Three.js-compatible lighting parameters
"""

def get_lighting_preset(time: str, biome: str = "city") -> dict:
    """
    Return lighting configuration for Three.js based on time of day and biome
    
    Args:
        time: "noon", "sunset", or "night"
        biome: "arctic", "city", etc.
    
    Returns:
        dict with ambient, directional, and fog settings
    """
    
    # Base presets
    presets = {
        "noon": {
            "ambient": {
                "color": "#ffffff",
                "intensity": 0.8
            },
            "directional": {
                "color": "#ffffff",
                "intensity": 0.8,
                "position": {"x": 50, "y": 100, "z": 50}
            },
            "fog": {
                "color": "#DDEEFF",  # Sky blue
                "near": 50,
                "far": 200
            },
            "background": "#87CEEB"  # Bright sky blue
        },
        
        "sunset": {
            "ambient": {
                "color": "#D85365",  # Soft peachy orange
                "intensity": 0.5
            },
            "directional": {
                "color": "#D5A29D",  # Gentle warm orange
                "intensity": 0.9,
                "position": {"x": 100, "y": 20, "z": 50}  # Low sun angle
            },
            "fog": {
                "color": "#d9a066",  # Muted golden orange
                "near": 30,
                "far": 150
            },
            "background": "#D85365"
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
    
    # Get base preset
    config = presets.get(time, presets["noon"]).copy()
    
    # Apply biome-specific modifications for arctic/icy/winter environments
    is_winter = biome.lower() in ["arctic", "winter", "icy"]
    is_arctic = biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"]
    
    # Arctic cave: bright light from above (simulating cave opening)
    if is_arctic:
        # Cave lighting: bright overhead light (like cave opening)
        config["background"] = "#E0F4FF"  # Bright icy blue (light from cave opening)
        config["ambient"]["color"] = "#B0E0FF"  # Cool blue ambient
        config["ambient"]["intensity"] = 0.6  # Moderate brightness
        config["directional"]["color"] = "#FFFFFF"  # Bright white overhead light
        config["directional"]["intensity"] = 1.2  # Very bright directional (cave opening)
        config["directional"]["position"] = {"x": 0, "y": 200, "z": 0}  # Directly overhead
        config["fog"] = {
            "color": "#C8E6FF",  # Light blue fog for cave atmosphere
            "near": 50,
            "far": 200
        }
        # Ensure northern lights are enabled for arctic
        config["northern_lights"] = True
    
    # City-specific modifications for noon
    if biome.lower() == "city" and time == "noon":
        config["background"] = "#D7AFF5"  # Purple-pink sky transitioning to butter cream yellow
        config["ambient"]["intensity"] = 0.85  # Bright ambient light
        config["directional"]["intensity"] = 0.85  # Bright directional light
    
    # Theme-specific lighting modifications (Gotham, Metropolis, etc.)
    is_gotham = biome.lower() in ["gotham", "batman"]
    if is_gotham:
        # Gotham is ALWAYS dark and moody
        config["background"] = "#0a0a0a"  # Almost black
        config["ambient"]["color"] = "#1a1a1a"  # Dark gray
        config["ambient"]["intensity"] = 0.2  # Very dim
        config["directional"]["color"] = "#2a2a3a"  # Dark blue-gray
        config["directional"]["intensity"] = 0.3  # Dim directional
        config["directional"]["position"] = {"x": 50, "y": 80, "z": 50}
        config["fog"] = {
            "color": "#1a1a2a",  # Dark fog
            "near": 30,
            "far": 150
        }
        # Force night time for Gotham
        time = "night"
    
    is_metropolis = biome.lower() in ["metropolis", "superman"]
    if is_metropolis:
        # Metropolis is bright and optimistic
        config["background"] = "#E8F4F8"  # Bright sky blue
        config["ambient"]["color"] = "#FFFFFF"  # Pure white
        config["ambient"]["intensity"] = 0.9  # Very bright
        config["directional"]["color"] = "#FFD700"  # Golden sunlight
        config["directional"]["intensity"] = 1.0  # Bright directional
        config["directional"]["position"] = {"x": 50, "y": 100, "z": 50}
        config["fog"] = None  # Clear skies
        # Force noon for Metropolis
        time = "noon"
    
    is_tokyo = biome.lower() in ["tokyo", "japan", "tokyo_world"]
    if is_tokyo and time == "night":
        # Tokyo at night: neon glow
        config["background"] = "#1a0a2e"  # Dark purple
        config["ambient"]["color"] = "#2d1b3d"  # Purple ambient
        config["ambient"]["intensity"] = 0.5
        config["directional"]["color"] = "#FF00FF"  # Magenta neon
        config["directional"]["intensity"] = 0.7
        config["fog"] = {
            "color": "#1a0a2e",
            "near": 40,
            "far": 180
        }
    
    is_venice = biome.lower() in ["venice", "italy", "venice_world"]
    if is_venice:
        # Venice: romantic golden hour
        config["background"] = "#FFB347"  # Warm sunset
        config["ambient"]["color"] = "#FFD700"  # Golden
        config["ambient"]["intensity"] = 0.6
        config["directional"]["color"] = "#FF8C00"  # Orange sunset
        config["directional"]["intensity"] = 0.8
        config["directional"]["position"] = {"x": 100, "y": 20, "z": 50}
        config["fog"] = None
    
    is_paris = biome.lower() in ["paris", "france", "paris_world"]
    if is_paris:
        # Paris: romantic sunset
        config["background"] = "#FFB6C1"  # Soft pink
        config["ambient"]["color"] = "#FFE4E1"  # Misty rose
        config["ambient"]["intensity"] = 0.7
        config["directional"]["color"] = "#FFD700"  # Golden hour
        config["directional"]["intensity"] = 0.8
        config["fog"] = None
    
    # Futuristic/Cyberpunk biome modifications
    is_futuristic = biome.lower() in ["futuristic", "cyberpunk", "neon", "tech"]
    if is_futuristic:
        if time == "night":
            # Dark cyberpunk night: very dark with neon accents
            config["background"] = "#0a0a1a"  # Almost black with slight blue
            config["ambient"]["color"] = "#1a1a3a"  # Dark blue ambient
            config["ambient"]["intensity"] = 0.3
            config["directional"]["color"] = "#00d4ff"  # Cyan neon light
            config["directional"]["intensity"] = 0.6
            config["directional"]["position"] = {"x": 50, "y": 80, "z": 50}
            config["fog"] = {
                "color": "#0a0a1a",
                "near": 30,
                "far": 150
            }
        elif time == "sunset":
            # Cyberpunk sunset: dark with purple/pink neon
            config["background"] = "#1a0a2e"  # Dark purple
            config["ambient"]["color"] = "#2d1b3d"  # Purple ambient
            config["ambient"]["intensity"] = 0.4
            config["directional"]["color"] = "#ff00ff"  # Magenta neon
            config["directional"]["intensity"] = 0.7
            config["directional"]["position"] = {"x": 100, "y": 20, "z": 50}
            config["fog"] = {
                "color": "#1a0a2e",
                "near": 40,
                "far": 180
            }
        else:  # noon
            # Cyberpunk day: dark with bright neon highlights
            config["background"] = "#0f1419"  # Dark blue-grey
            config["ambient"]["color"] = "#1a1a2e"  # Dark blue ambient
            config["ambient"]["intensity"] = 0.5
            config["directional"]["color"] = "#00d4ff"  # Bright cyan
            config["directional"]["intensity"] = 0.8
            config["directional"]["position"] = {"x": 50, "y": 100, "z": 50}
            config["fog"] = {
                "color": "#0f1419",
                "near": 50,
                "far": 200
            }
    
    # Remove fog for non-arctic, non-futuristic biomes
    if not is_winter and not is_futuristic:
        config["fog"] = None
    
    if is_winter:
        # Add very light white fog for arctic landscapes (very faint, closer but not blocking sky)
        if time == "noon":
            config["fog"]["color"] = "#FFFFFF"  # Very light white fog
            config["fog"]["near"] = 80   # Start fog a bit closer than before
            config["fog"]["far"] = 500   # Long range so fog stays very subtle
            config["background"] = "#87CEEB"  # Blue sky visible
            config["ambient"]["color"] = "#ffffff"  # Slightly blue-tinted ambient
        elif time == "sunset":
            config["fog"]["color"] = "#FFF5E6"  # Warm white fog for sunset
            config["fog"]["near"] = 120
            config["fog"]["far"] = 350
            config["background"] = "#D85365"
        elif time == "night":
            config["fog"]["color"] = "#E6E6FF"  # Slightly blue-tinted white fog at night
            config["fog"]["near"] = 80
            config["fog"]["far"] = 250
            config["background"] = "#2543DE"
    
    # Add northern lights flag for arctic biomes
    config["northern_lights"] = is_arctic
    
    return config


def get_sky_color(time: str, biome: str = "city") -> str:
    """
    Get background/sky color for a given time and biome
    
    Args:
        time: "noon", "sunset", or "night"
        biome: "arctic", "city", etc.
    
    Returns:
        Hex color string
    """
    if biome == "arctic":
        colors = {
            "noon": "#CCE5FF",    # Icy blue
            "sunset": "#B3D9FF",  # Cool sunset
            "night": "#001133"    # Dark blue
        }
    else:
        colors = {
            "noon": "#e9f3ff",    # Sky blue
            "sunset": "#d9a066",  # Muted golden orange
            "night": "#001133"    # Dark blue
        }
    return colors.get(time, colors["noon"])


def interpolate_lighting(from_time: str, to_time: str, progress: float, biome: str = "city") -> dict:
    """
    Smoothly transition between two lighting presets
    Useful for live time-of-day changes
    
    Args:
        from_time: Starting time preset
        to_time: Target time preset
        progress: 0.0 to 1.0 (0 = from_time, 1 = to_time)
        biome: Current biome for biome-specific lighting
    
    Returns:
        Interpolated lighting config
    """
    from_preset = get_lighting_preset(from_time, biome)
    to_preset = get_lighting_preset(to_time, biome)
    
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
    
    # Northern lights flag doesn't interpolate - it's based on biome
    is_arctic = biome.lower() in ["arctic", "winter", "icy", "snow", "frozen"]
    
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
        "background": lerp_color(from_preset["background"], to_preset["background"], progress),
        "northern_lights": is_arctic
    }


# Example usage
if __name__ == "__main__":
    import json
    
    print("=== Lighting Presets ===\n")
    
    for biome in ["city", "arctic"]:
        print(f"\n--- {biome.upper()} ---")
        for time in ["noon", "sunset", "night"]:
            preset = get_lighting_preset(time, biome)
            print(f"{time.upper()}:")
            print(json.dumps(preset, indent=2))
            print()