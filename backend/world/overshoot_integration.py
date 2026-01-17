"""
Vision AI Integration for Environment Scanning
Supports OpenAI Vision API (recommended for single images) and Overshoot AI (streaming only).

NOTE: Overshoot AI SDK (@overshoot/sdk) is designed for real-time video streaming,
not single image analysis. For single image capture (our use case), OpenAI Vision API
is the recommended approach.

To use:
1. OpenAI Vision (recommended): Set OPENAI_API_KEY in .env
2. Overshoot AI (if REST endpoint exists): Set OVERSHOOT_API_KEY in .env
"""
import os
import requests
from typing import Dict, List, Optional
import json
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

OVERSHOOT_API_KEY = os.getenv("OVERSHOOT_API_KEY")
OVERSHOOT_API_URL = os.getenv("OVERSHOOT_API_URL", "https://cluster1.overshoot.ai/api/v0.2")

# Debug: Check if API keys are loaded
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
if OPENAI_API_KEY:
    print(f"[VISION] OpenAI API key loaded (length: {len(OPENAI_API_KEY)} characters)")
if OVERSHOOT_API_KEY:
    print(f"[VISION] Overshoot API key loaded (length: {len(OVERSHOOT_API_KEY)} characters)")
    print(f"[VISION] Overshoot API URL: {OVERSHOOT_API_URL}")
    print("[VISION] NOTE: Overshoot SDK is for streaming video, not single images.")
    print("[VISION] For single image analysis, OpenAI Vision is recommended.")
if not OPENAI_API_KEY and not OVERSHOOT_API_KEY:
    print("[VISION] WARNING: No vision API keys found!")
    print("[VISION] Set either OPENAI_API_KEY or OVERSHOOT_API_KEY in backend/.env")

async def analyze_with_openai_vision(image_data: str) -> Optional[Dict]:
    """
    Alternative: Use OpenAI Vision API to analyze environment.
    Set OPENAI_API_KEY in .env to use this instead of Overshoot.
    """
    openai_key = os.getenv("OPENAI_API_KEY")
    if not openai_key:
        print("[VISION] ❌ OPENAI_API_KEY not set in environment")
        return None
    
    try:
        import openai
        from openai import OpenAI
        
        # Check if this is an OpenRouter API key (starts with "sk-or-")
        is_openrouter = openai_key.startswith("sk-or-")
        
        if is_openrouter:
            # Use OpenRouter endpoint with required headers
            base_url = "https://openrouter.ai/api/v1"
            default_headers = {
                "HTTP-Referer": "http://localhost:3000",  # Your app URL
                "X-Title": "AI World Builder"  # Your app name
            }
            print(f"[VISION] Using OpenRouter API (key: {openai_key[:10]}...)")
        else:
            # Use standard OpenAI endpoint
            base_url = None  # Use default OpenAI endpoint
            default_headers = {}
            print(f"[VISION] Using OpenAI API (key: {openai_key[:10]}...)")
        
        client = OpenAI(
            api_key=openai_key,
            base_url=base_url,
            default_headers=default_headers if is_openrouter else None
        )
        
        # Remove data URL prefix
        image_base64 = image_data
        if ',' in image_data:
            image_base64 = image_data.split(',')[1]
        
        # Validate image size (base64 images should be much larger)
        if len(image_base64) < 1000:
            print(f"[VISION] ❌ Image data too small: {len(image_base64)} chars (expected >1000 for valid base64 image)")
            print(f"[VISION] Image data preview: {image_base64[:200]}")
            return None
        
        print(f"[VISION] Using {'OpenRouter' if is_openrouter else 'OpenAI'} Vision API... (image size: {len(image_base64)} chars)")
        
        # For OpenRouter, use provider/model format (e.g., "openai/gpt-4o-mini")
        # For OpenAI, use model name directly (e.g., "gpt-4o-mini")
        model_name = "openai/gpt-4o-mini" if is_openrouter else "gpt-4o-mini"
        
        response = client.chat.completions.create(
            model=model_name,
            messages=[
                {
                    "role": "system",
                    "content": """Analyze this image in EXTREME DETAIL and return a JSON object that accurately represents what you see.

Be very specific and detailed about:
- The environment type (indoor room, outdoor scene, nature, urban, etc.)
- All objects visible (furniture, people, structures, natural elements, etc.)
- Colors and lighting (dominant colors, light sources, time of day feeling)
- Spatial layout (arrangement, positioning, density)
- Materials and textures (wood, metal, concrete, fabric, etc.)

Convert what you see into a 3D game world that matches the image:
- Indoor scenes → city biome with buildings/structures representing the room
- Outdoor scenes → appropriate biome (forest, city, desert, etc.) with matching objects
- Objects in image → place similar structures/creative objects in the world

Return a JSON object with:
{
  "objects": [
    {"type": "tree", "count": 5},
    {"type": "rock", "count": 3}
  ],
  "terrain": {"type": "arctic|forest|desert|city|mountainous", "elevation": "low|medium|high"},
  "weather": {"condition": "clear|cloudy|rainy|snowy|foggy"},
  "colors": {
    "palette": ["#HEX", "#HEX"]
  },
  "spatial_layout": [
    {"object": "tree", "position": "foreground|midground|background", "density": "sparse|medium|dense"}
  ]
}

Detect objects like: trees, rocks, buildings, mountains, street lamps, etc."""
                },
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_base64}"
                            }
                        }
                    ]
                }
            ],
            max_tokens=1000,
            response_format={"type": "json_object"}
        )
        
        result_text = response.choices[0].message.content
        result = json.loads(result_text)
        
        print(f"[VISION] [OK] OpenAI Vision analyzed image successfully")
        return parse_overshoot_response(result)
        
    except Exception as e:
        print(f"[VISION] OpenAI Vision error: {e}")
        import traceback
        traceback.print_exc()
        return None


async def analyze_environment(image_data: str) -> Dict:
    """
    Analyze environment image using available vision AI services.
    
    Priority:
    1. OpenAI Vision API (recommended - designed for single images)
    2. Overshoot AI REST endpoint (if available - NOTE: Overshoot SDK is for streaming)
    3. Fallback mock data
    
    Args:
        image_data: Base64 encoded image string (with or without data URL prefix)
    
    Returns:
        Dict with:
        - biome: "arctic"|"forest"|"desert"|"city"|"default"
        - objects: Dict of object counts {"tree": 5, "rock": 3, ...}
        - colors: List of hex color codes
        - spatial_layout: List of object positions
        - weather: Weather condition string
        - terrain_type: Terrain type string
    """
    # Try OpenAI Vision first (recommended for single image analysis)
    openai_result = await analyze_with_openai_vision(image_data)
    if openai_result:
        print("[VISION] ✅ Using OpenAI Vision API result")
        return openai_result
    
    # If no APIs available, use fallback
    if not OVERSHOOT_API_KEY and not OPENAI_API_KEY:
        print("[VISION] No API keys set - using fallback mode")
        print("[VISION] To use real AI analysis:")
        print("[VISION]   - Set OPENAI_API_KEY in .env (recommended for single images)")
        print("[VISION]   - OR set OVERSHOOT_API_KEY in .env (if REST endpoint exists)")
        # Return mock data for testing without API key
        return {
            "biome": "arctic",
            "objects": {"tree": 15, "rock": 8, "peak": 3},
            "colors": ["#FFFFFF", "#87CEEB", "#2d5016", "#808080"],
            "spatial_layout": [
                {"object": "tree", "position": "foreground", "density": "medium"},
                {"object": "mountain", "position": "background", "size": "large"}
            ],
            "weather": "snowy",
            "terrain_type": "mountainous"
        }
    
    try:
        # Remove data URL prefix if present (format: "data:image/jpeg;base64,/9j/4AAQ...")
        image_base64 = image_data.strip()
        
        # Check if it's a data URL
        if image_base64.startswith('data:'):
            # Find the comma that separates the metadata from the base64 data
            comma_index = image_base64.find(',')
            if comma_index != -1:
                image_base64 = image_base64[comma_index + 1:]
            else:
                print(f"[VISION] [ERROR] Invalid data URL format (no comma found)")
                print(f"[VISION] Image data preview (first 100 chars): {image_data[:100]}")
                return None
        else:
            # Assume it's already base64
            image_base64 = image_data
        
        # Validate that we have actual data
        if not image_base64 or len(image_base64) < 100:
            print(f"[VISION] [ERROR] Image data too small or empty")
            print(f"[VISION] Image data length: {len(image_base64)} bytes")
            print(f"[VISION] Image data preview (first 200 chars): {image_data[:200]}")
            return None
        
        headers = {
            "Authorization": f"Bearer {OVERSHOOT_API_KEY}",
            "Content-Type": "application/json"
        }
        
        payload = {
            "image": image_base64,
            "analysis_type": "environment_scan",
            "features": [
                "object_detection",
                "terrain_classification",
                "weather_detection",
                "color_palette",
                "spatial_relationships"
            ]
        }
        
        # Try Overshoot REST endpoint (if it exists - NOTE: Overshoot SDK is primarily for streaming)
        print(f"[VISION] Attempting Overshoot AI REST endpoint: {OVERSHOOT_API_URL}")
        print(f"[VISION] Image data size: {len(image_base64)} bytes (base64)")
        print(f"[VISION] Using API key: {OVERSHOOT_API_KEY[:10]}...{OVERSHOOT_API_KEY[-5:] if len(OVERSHOOT_API_KEY) > 15 else '***'}")
        
        response = requests.post(
            OVERSHOOT_API_URL,
            headers=headers,
            json=payload,
            timeout=30
        )
        
        print(f"[VISION] Response status: {response.status_code}")
        
        if response.status_code == 200:
            result = response.json()
            print(f"[VISION] [OK] Successfully analyzed image with Overshoot")
            print(f"[VISION] Response keys: {list(result.keys())}")
            try:
                parsed = parse_overshoot_response(result)
                print(f"[VISION] Parsed result: biome={parsed.get('biome')}, objects={parsed.get('objects')}")
                return parsed
            except Exception as parse_error:
                print(f"[OVERSHOOT] ❌ Error parsing response: {parse_error}")
                import traceback
                traceback.print_exc()
                return None
        elif response.status_code == 401:
            print(f"[VISION] [ERROR] Authentication Error (401): Invalid API key")
            print(f"[VISION] Check that OVERSHOOT_API_KEY in .env is correct")
            print(f"[VISION] Response: {response.text[:500]}")
            return None
        elif response.status_code == 404:
            print(f"[VISION] [ERROR] Not Found (404): API endpoint does not exist")
            print(f"[VISION] Current URL: {OVERSHOOT_API_URL}")
            print(f"[VISION] Check if the endpoint URL is correct in .env or overshoot_integration.py")
            print(f"[VISION] Response: {response.text[:500]}")
            return None
        elif response.status_code == 400:
            print(f"[VISION] [ERROR] Bad Request (400): Invalid request format")
            print(f"[VISION] The API doesn't accept this request format")
            print(f"[VISION] Response: {response.text[:1000]}")
            return None
        else:
            print(f"[VISION] [ERROR] API Error: {response.status_code}")
            print(f"[VISION] Response headers: {dict(response.headers)}")
            print(f"[VISION] Response text: {response.text[:1000]}")  # First 1000 chars
            return None
            
    except requests.exceptions.Timeout:
        print(f"[VISION] [ERROR] Request timeout (30s)")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"[VISION] [ERROR] Connection error: {e}")
        print(f"[VISION] Could not reach {OVERSHOOT_API_URL}")
        print(f"[VISION] This could mean:")
        print(f"[VISION]   1. The API endpoint URL is incorrect")
        print(f"[VISION]   2. No internet connection")
        print(f"[VISION]   3. The API service is down")
        print(f"[VISION] NOTE: Overshoot SDK is for streaming video, not single images.")
        print(f"[VISION] Falling back to mock data for testing...")
        # Return mock data so the user can still test the integration
        return {
            "biome": "arctic",
            "objects": {"tree": 15, "rock": 8, "peak": 3},
            "colors": ["#FFFFFF", "#87CEEB", "#2d5016", "#808080"],
            "spatial_layout": [
                {"object": "tree", "position": "foreground", "density": "medium"},
                {"object": "mountain", "position": "background", "size": "large"}
            ],
            "weather": "snowy",
            "terrain_type": "mountainous"
        }
    except requests.exceptions.RequestException as e:
        print(f"[VISION] [ERROR] Request error: {e}")
        return None
    except Exception as e:
        print(f"[OVERSHOOT] ❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return None


def parse_overshoot_response(raw_response: Dict) -> Dict:
    """
    Parse Overshoot API response into world generation parameters.
    
    Handles multiple response formats flexibly.
    
    Example response structure:
    {
        "objects": [
            {"type": "tree", "count": 15, "confidence": 0.95},
            {"type": "rock", "count": 5, "confidence": 0.87}
        ],
        "terrain": {"type": "mountainous", "elevation": "high", "confidence": 0.92},
        "weather": {"condition": "snowy", "confidence": 0.88},
        "colors": {
            "dominant": ["#FFFFFF", "#2d5016", "#808080"],
            "palette": ["#FFFFFF", "#2d5016", "#808080", "#4A90E2"]
        },
        "spatial_layout": [
            {"object": "tree", "position": "foreground", "density": "sparse"},
            {"object": "mountain", "position": "background", "size": "large"}
        ]
    }
    """
    print(f"[OVERSHOOT] Parsing response. Keys: {list(raw_response.keys())}")
    
    # Extract objects - handle different formats
    objects = {}
    objects_data = raw_response.get("objects", [])
    
    if isinstance(objects_data, list):
        for obj in objects_data:
            if isinstance(obj, dict):
                obj_type_str = obj.get("type") or obj.get("name") or obj.get("object_type")
                if obj_type_str:
                    obj_type = map_object_type(obj_type_str)
                    if obj_type:
                        count = obj.get("count") or obj.get("quantity") or 1
                        objects[obj_type] = objects.get(obj_type, 0) + count
            elif isinstance(obj, str):
                # Handle case where objects is a list of strings
                obj_type = map_object_type(obj)
                if obj_type:
                    objects[obj_type] = objects.get(obj_type, 0) + 1
    elif isinstance(objects_data, dict):
        # Handle case where objects is a dict like {"tree": 5, "rock": 3}
        for obj_type_str, count in objects_data.items():
            obj_type = map_object_type(obj_type_str)
            if obj_type:
                objects[obj_type] = count
    
    # Map terrain to biome - handle different formats
    terrain_data = raw_response.get("terrain", {})
    if isinstance(terrain_data, str):
        terrain_type = terrain_data
        terrain_data = {"type": terrain_type}
    elif not isinstance(terrain_data, dict):
        terrain_data = {}
    
    weather_data = raw_response.get("weather", {})
    if isinstance(weather_data, str):
        weather_condition = weather_data
        weather_data = {"condition": weather_condition}
    elif not isinstance(weather_data, dict):
        weather_data = {}
    
    biome = map_terrain_to_biome(
        terrain_data.get("type") or terrain_data.get("name"),
        weather_data.get("condition") or weather_data.get("type")
    )
    
    # Extract colors for structures - handle different formats
    colors_data = raw_response.get("colors", {})
    if isinstance(colors_data, list):
        color_palette = colors_data
    elif isinstance(colors_data, dict):
        palette = colors_data.get("palette") or colors_data.get("dominant")
        if isinstance(palette, list):
            color_palette = palette
        elif isinstance(palette, str):
            color_palette = [palette]
        else:
            color_palette = []
    elif isinstance(colors_data, str):
        color_palette = [colors_data]
    elif isinstance(colors_data, (int, float)):
        # Skip numeric colors (not valid hex)
        color_palette = []
    else:
        color_palette = []
    
    # Extract spatial layout for positioning
    spatial_layout = raw_response.get("spatial_layout", [])
    if not isinstance(spatial_layout, list):
        spatial_layout = []
    
    result = {
        "biome": biome,
        "objects": objects,
        "colors": color_palette,
        "spatial_layout": spatial_layout,
        "weather": weather_data.get("condition") or weather_data.get("type") or "clear",
        "terrain_type": terrain_data.get("type") or terrain_data.get("name") or "flat"
    }
    
    print(f"[OVERSHOOT] Parsed: {result}")
    return result


def map_object_type(overshoot_type: str) -> Optional[str]:
    """Map Overshoot object types to your world structure types."""
    if not overshoot_type:
        return None
    
    overshoot_type_lower = overshoot_type.lower().strip()
    
    mapping = {
        "tree": "tree",
        "trees": "tree",
        "pine_tree": "tree",
        "pine": "tree",
        "oak_tree": "tree",
        "oak": "tree",
        "spruce": "tree",
        "birch": "tree",
        "forest": "tree",
        "woods": "tree",
        "jungle": "tree",
        "park": "tree",
        "garden": "tree",
        "rock": "rock",
        "rocks": "rock",
        "boulder": "rock",
        "boulders": "rock",
        "stone": "rock",
        "stones": "rock",
        "cliff": "peak",
        "cliffs": "peak",
        "building": "building",
        "buildings": "building",
        "house": "building",
        "houses": "building",
        "skyscraper": "building",
        "skyscrapers": "building",
        "tower": "building",
        "towers": "building",
        "structure": "building",
        "block": "building",
        "blocks": "building",
        "car": "building",
        "cars": "building",
        "vehicle": "building",
        "vehicles": "building",
        "truck": "building",
        "trucks": "building",
        "bus": "building",
        "buses": "building",
        "taxi": "building",
        "mountain": "peak",
        "mountains": "peak",
        "peak": "peak",
        "peaks": "peak",
        "hill": "peak",
        "hills": "peak",
        "streetlight": "street_lamp",
        "street_light": "street_lamp",
        "street_lamp": "street_lamp",
        "street_lights": "street_lamp",
        "lamp": "street_lamp",
        "lamps": "street_lamp",
        "lamp_post": "street_lamp",
        "lamppost": "street_lamp",
        "traffic_light": "street_lamp",
        "traffic_lights": "street_lamp",
        "light": "street_lamp",
        "lights": "street_lamp",
        "road": "street_lamp",
        "roads": "street_lamp",
        "street": "street_lamp",
        "streets": "street_lamp",
        "highway": "street_lamp",
        "bridge": "street_lamp"
    }
    
    # Try direct match first
    result = mapping.get(overshoot_type_lower)
    if result:
        return result
    
    # Try partial matches
    for key, value in mapping.items():
        if key in overshoot_type_lower or overshoot_type_lower in key:
            return value
    
    print(f"[OVERSHOOT] Unknown object type: {overshoot_type}, skipping")
    return None


def map_terrain_to_biome(terrain_type: Optional[str], weather: Optional[str]) -> str:
    """Map Overshoot terrain/weather to your biome system."""
    if not terrain_type:
        if weather and "snow" in weather.lower():
            return "arctic"
        return "city"
    
    terrain_lower = terrain_type.lower()
    weather_lower = (weather or "").lower()
    
    if "snow" in weather_lower or "winter" in terrain_lower or "arctic" in terrain_lower:
        return "arctic"
    
    if "mountain" in terrain_lower or "elevated" in terrain_lower:
        return "arctic"
    
    if "desert" in terrain_lower or "sand" in terrain_lower or "dune" in terrain_lower:
        return "desert"
    
    if "forest" in terrain_lower or "jungle" in terrain_lower or "woods" in terrain_lower:
        return "forest"
    
    if "beach" in terrain_lower or "coast" in terrain_lower or "island" in terrain_lower:
        return "beach"
    
    if "ocean" in terrain_lower or "sea" in terrain_lower or "underwater" in terrain_lower:
        return "underwater"
    
    if "gotham" in terrain_lower:
        return "gotham"
    
    if "spiderman" in terrain_lower or "spider-man" in terrain_lower or "spider man" in terrain_lower:
        return "spiderman_world"
    
    if "futuristic" in terrain_lower or "cyberpunk" in terrain_lower or "neon" in terrain_lower:
        return "futuristic"
    
    if "venice" in terrain_lower or "italy" in terrain_lower:
        return "venice"
    
    if "paris" in terrain_lower or "france" in terrain_lower:
        return "paris"
    
    if "urban" in terrain_lower or "city" in terrain_lower:
        return "city"
    
    return "city"


def generate_world_from_scan(scan_data: Dict) -> Dict:
    """
    Generate world parameters from Overshoot scan data.
    This integrates with your existing world generation system.
    
    Args:
        scan_data: Parsed Overshoot response
    
    Returns:
        Dict compatible with your generate_world function
    """
    biome = scan_data.get("biome", "city")
    objects = scan_data.get("objects", {})
    colors_raw = scan_data.get("colors", [])
    spatial_layout = scan_data.get("spatial_layout", [])
    
    # Ensure colors is always a list
    if isinstance(colors_raw, list):
        colors = colors_raw
    elif isinstance(colors_raw, str):
        colors = [colors_raw]
    elif isinstance(colors_raw, (int, float)):
        # Convert numeric color to hex string if needed
        colors = []
    else:
        colors = []
    
    # Build structure counts
    structure_counts = {
        "tree": objects.get("tree", 10),
        "rock": objects.get("rock", 5),
        "building": objects.get("building", 0),
        "mountain": objects.get("peak", 0),
        "street_lamp": objects.get("street_lamp", 0)
    }
    
    # Adjust based on biome
    if biome == "arctic":
        structure_counts["mountain"] = max(structure_counts.get("mountain", 0), 2)
        structure_counts["tree"] = min(structure_counts.get("tree", 0), 15)
    elif biome == "city":
        structure_counts["building"] = max(structure_counts.get("building", 0), 10)
        structure_counts["street_lamp"] = max(structure_counts.get("street_lamp", 0), 5)
    
    # Extract tree colors if available
    tree_colors = extract_tree_colors(colors, spatial_layout)
    
    # Determine time of day from lighting/weather
    time_of_day = determine_time_of_day(scan_data.get("weather"), colors)
    
    return {
        "biome": biome,
        "time": time_of_day,
        "structure": structure_counts,
        "tree_colors": tree_colors,  # Pass to tree generation
        "enemy_count": 3,  # Default
        "weapon": "both"
    }


def extract_tree_colors(color_palette, spatial_layout) -> Dict:
    """Extract tree-specific colors from scan data."""
    # Ensure color_palette is a list
    if not isinstance(color_palette, list):
        color_palette = []
    if not isinstance(spatial_layout, list):
        spatial_layout = []
    
    # Find tree-related colors
    leaf_colors = []
    trunk_colors = []
    
    for item in spatial_layout:
        if item.get("object") in ["tree", "trees"]:
            # Extract colors for trees specifically
            # Overshoot might provide object-specific colors
            if "colors" in item:
                leaf_colors = item["colors"].get("leaves", [])
                trunk_colors = item["colors"].get("trunk", [])
    
    # Fallback: Extract from general palette
    if not leaf_colors and color_palette:
        # Look for green shades (likely leaves)
        for color in color_palette:
            if is_green_shade(color):
                leaf_colors.append(color)
            elif is_brown_shade(color):
                trunk_colors.append(color)
    
    return {
        "leaf_color": leaf_colors[0] if leaf_colors else "#228B22",
        "trunk_color": trunk_colors[0] if trunk_colors else "#8b4513"
    }


def is_green_shade(hex_color: str) -> bool:
    """Check if color is a shade of green."""
    try:
        hex_color = hex_color.lstrip('#')
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return g > r and g > b
    except:
        return False


def is_brown_shade(hex_color: str) -> bool:
    """Check if color is a shade of brown."""
    try:
        hex_color = hex_color.lstrip('#')
        r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
        return r > g > b and r < 200  # Brown is muted red
    except:
        return False


def determine_time_of_day(weather: Optional[str], colors) -> str:
    """Determine time of day from weather and lighting."""
    # Ensure colors is a list
    if not isinstance(colors, list):
        colors = []
    
    if not colors:
        return "noon"
    
    # Analyze brightness of dominant colors
    avg_brightness = 0
    for color in colors[:3]:  # Top 3 colors
        try:
            hex_color = color.lstrip('#')
            r, g, b = int(hex_color[0:2], 16), int(hex_color[2:4], 16), int(hex_color[4:6], 16)
            brightness = (r + g + b) / 3
            avg_brightness += brightness
        except:
            continue
    
    avg_brightness /= min(3, len(colors))
    
    # Map brightness to time of day
    if avg_brightness > 180:
        return "noon"
    elif avg_brightness > 100:
        return "sunset"
    else:
        return "night"
