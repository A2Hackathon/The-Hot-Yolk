"""
Color Scheme System for Landscape Elements
Maps color palette to specific landscape elements with aesthetic variations
"""
import colorsys
from typing import List, Dict, Tuple, Optional


def hex_to_rgb(hex_color: str) -> Tuple[int, int, int]:
    """Convert hex color to RGB tuple."""
    hex_color = hex_color.lstrip('#')
    return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))


def rgb_to_hex(rgb: Tuple[int, int, int]) -> str:
    """Convert RGB tuple to hex color."""
    return f"#{rgb[0]:02x}{rgb[1]:02x}{rgb[2]:02x}"


def adjust_shade(rgb: Tuple[int, int, int], lighten: float = 0.0, darken: float = 0.0, 
                 saturate: float = 0.0, desaturate: float = 0.0) -> Tuple[int, int, int]:
    """
    Adjust color shade/saturation for aesthetic variations.
    
    Args:
        rgb: RGB color tuple
        lighten: Amount to lighten (0.0-1.0)
        darken: Amount to darken (0.0-1.0)
        saturate: Amount to saturate (0.0-1.0)
        desaturate: Amount to desaturate (0.0-1.0)
    
    Returns:
        Adjusted RGB tuple
    """
    # Convert to HLS for easier manipulation (note: colorsys uses HLS, not HSL)
    r, g, b = [c / 255.0 for c in rgb]
    h, l, s = colorsys.rgb_to_hls(r, g, b)  # HLS order: hue, lightness, saturation
    
    # Adjust lightness
    if lighten > 0:
        l = min(1.0, l + lighten * (1.0 - l))
    if darken > 0:
        l = max(0.0, l - darken * l)
    
    # Adjust saturation
    if saturate > 0:
        s = min(1.0, s + saturate * (1.0 - s))
    if desaturate > 0:
        s = max(0.0, s - desaturate * s)
    
    # Convert back to RGB
    r, g, b = colorsys.hls_to_rgb(h, l, s)
    return (int(r * 255), int(g * 255), int(b * 255))


def assign_palette_to_elements(color_palette: List[str]) -> Dict[str, str]:
    """
    Assign palette colors to landscape elements.
    
    Color mapping:
    - Index 0: Ground/Terrain (base color)
    - Index 1: Trees (leaves)
    - Index 2: Buildings
    - Index 3: Mountains/Peaks
    - Index 4: Rocks
    - Index 5: Sky/Background
    - Index 6+: Additional elements (trunks, accents, etc.)
    
    Args:
        color_palette: List of hex color strings
    
    Returns:
        Dict mapping element names to hex colors (with variations)
    """
    # Ensure color_palette is a list before checking length
    if not color_palette or not isinstance(color_palette, list) or len(color_palette) == 0:
        return {}
    
    assignments = {}
    
    # Ground/Terrain (first color - base, use as-is)
    ground_base = hex_to_rgb(color_palette[0])
    assignments["ground"] = rgb_to_hex(ground_base)
    assignments["ground_light"] = rgb_to_hex(adjust_shade(ground_base, lighten=0.15, saturate=0.1))
    assignments["ground_dark"] = rgb_to_hex(adjust_shade(ground_base, darken=0.15, desaturate=0.1))
    
    # Trees (Color 1 - MANDATORY)
    # Palette MUST have at least 5 colors, so index 1 should always exist
    if len(color_palette) >= 2:
        tree_base = hex_to_rgb(color_palette[1])
        assignments["tree_leaves"] = rgb_to_hex(adjust_shade(tree_base, saturate=0.2))  # More vibrant for leaves
        assignments["tree_leaves_light"] = rgb_to_hex(adjust_shade(tree_base, lighten=0.2, saturate=0.15))
        assignments["tree_leaves_dark"] = rgb_to_hex(adjust_shade(tree_base, darken=0.2, saturate=0.1))
        # Tree trunks (darker, desaturated version of tree color)
        assignments["tree_trunk"] = rgb_to_hex(adjust_shade(tree_base, darken=0.5, desaturate=0.4))
    else:
        # FALLBACK: Should not happen if AI follows instructions
        print(f"[COLOR SCHEME] ⚠️ WARNING: Palette too small for trees, using ground color")
        tree_base = ground_base
        assignments["tree_leaves"] = rgb_to_hex(adjust_shade(tree_base, saturate=0.2))
        assignments["tree_leaves_light"] = rgb_to_hex(adjust_shade(tree_base, lighten=0.2, saturate=0.15))
        assignments["tree_leaves_dark"] = rgb_to_hex(adjust_shade(tree_base, darken=0.2, saturate=0.1))
        assignments["tree_trunk"] = rgb_to_hex(adjust_shade(tree_base, darken=0.5, desaturate=0.4))
    
    # Buildings (Color 2 - MANDATORY)
    # Palette MUST have at least 5 colors, so index 2 should always exist
    if len(color_palette) >= 3:
        building_base = hex_to_rgb(color_palette[2])
        assignments["building"] = rgb_to_hex(building_base)
        assignments["building_light"] = rgb_to_hex(adjust_shade(building_base, lighten=0.25))
        assignments["building_dark"] = rgb_to_hex(adjust_shade(building_base, darken=0.15))
    else:
        # FALLBACK: Should not happen if AI follows instructions
        print(f"[COLOR SCHEME] ⚠️ WARNING: Palette too small for buildings, using tree color")
        building_base = tree_base if 'tree_base' in locals() else ground_base
        building_base = adjust_shade(building_base, lighten=0.3, desaturate=0.2) if isinstance(building_base, tuple) else adjust_shade(hex_to_rgb(assignments.get("tree_leaves", color_palette[0])), lighten=0.3, desaturate=0.2)
        assignments["building"] = rgb_to_hex(building_base)
        assignments["building_light"] = rgb_to_hex(adjust_shade(building_base, lighten=0.2))
        assignments["building_dark"] = rgb_to_hex(adjust_shade(building_base, darken=0.15))
    
    # Mountains/Peaks (Color 3 - MANDATORY)
    # Palette MUST have at least 5 colors, so index 3 should always exist
    if len(color_palette) >= 4:
        mountain_base = hex_to_rgb(color_palette[3])
        assignments["mountain"] = rgb_to_hex(mountain_base)
        assignments["mountain_light"] = rgb_to_hex(adjust_shade(mountain_base, lighten=0.3))
        assignments["mountain_dark"] = rgb_to_hex(adjust_shade(mountain_base, darken=0.2))
    else:
        # FALLBACK: Should not happen if AI follows instructions
        print(f"[COLOR SCHEME] ⚠️ WARNING: Palette too small for mountains, using ground color")
        mountain_base = adjust_shade(ground_base, darken=0.2, desaturate=0.2)
        assignments["mountain"] = rgb_to_hex(mountain_base)
        assignments["mountain_light"] = rgb_to_hex(adjust_shade(mountain_base, lighten=0.2))
        assignments["mountain_dark"] = rgb_to_hex(adjust_shade(mountain_base, darken=0.2))
    
    # Rocks (use mountain color variation - no dedicated color needed)
    # Use mountain color but darker for rocks
    rock_base = adjust_shade(hex_to_rgb(assignments["mountain"]), darken=0.15, desaturate=0.2)
    assignments["rock"] = rgb_to_hex(rock_base)
    
    # Sky/Background (MANDATORY - Color 4, index 4)
    # CRITICAL: Palette MUST have at least 5 colors, with index 4 being sky
    if len(color_palette) >= 5:
        # Use the dedicated sky color (index 4)
        sky_base = hex_to_rgb(color_palette[4])
        assignments["sky"] = rgb_to_hex(adjust_shade(sky_base, lighten=0.1, saturate=0.05))  # Slight adjustment only
        assignments["sky_dark"] = rgb_to_hex(adjust_shade(sky_base, darken=0.1))
    else:
        # FALLBACK: If palette is too small, generate sky from ground color
        # This should NOT happen if AI follows instructions (minimum 5 colors)
        print(f"[COLOR SCHEME] ⚠️ WARNING: Palette has only {len(color_palette)} colors, generating sky fallback")
        sky_base = hex_to_rgb(color_palette[0])
        assignments["sky"] = rgb_to_hex(adjust_shade(sky_base, lighten=0.7, saturate=0.2))
        assignments["sky_dark"] = rgb_to_hex(adjust_shade(sky_base, lighten=0.5))
    
    # Street lamps (optional - use a complementary or accent color)
    if len(color_palette) >= 2:
        lamp_base = hex_to_rgb(color_palette[1])
        assignments["street_lamp"] = rgb_to_hex(adjust_shade(lamp_base, saturate=0.3, lighten=0.2))
    else:
        assignments["street_lamp"] = "#FFD700"  # Default gold
    
    print(f"[COLOR SCHEME] Assigned colors to elements: {list(assignments.keys())}")
    return assignments
