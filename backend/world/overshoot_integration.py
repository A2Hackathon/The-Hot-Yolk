"""
Vision AI Integration for Environment Scanning
Supports OpenAI Vision API (recommended for single images) and Overshoot AI (streaming only).

NOTE: Overshoot AI SDK (@overshoot/sdk) is designed for real-time video streaming,
not single image analysis. For single image capture (our use case), OpenAI Vision API
is the recommended approach.
"""
import os
import random
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
                    "content": """You are a technical image analysis API. Return ONLY a JSON object. NO descriptions, NO markdown, NO bullet points, NO verbose text. KEEP ALL TEXT TO ONE SENTENCE MAXIMUM (ideally zero sentences - pure JSON only).

CRITICAL RULES:
1. Output MUST be pure JSON only - no explanations, no descriptions, no text outside JSON (if absolutely necessary, one sentence maximum only)
2. EVERY color MUST be in hex format (#RRGGBB) - NEVER use color names like "light lavender", "pale purple", "blue", etc.
3. Convert ALL color descriptions to hex BEFORE returning:
   - "light lavender" → "#E6E6FA"
   - "pale purple" → "#DDA0DD"
   - "bright blue" → "#4169E1"
   - "warm white" → "#FFF8DC"
   - If you cannot determine exact hex, use closest match from standard color palette
4. For each object, provide exact hex codes: tree leaves, tree trunk, rock color, building color, furniture color, etc.
5. Count objects accurately and provide hex colors for EACH type
6. For indoor/room scenes, set biome to "room" or include room-related keywords
7. ALL TEXT DESCRIPTIONS MUST BE ONE SENTENCE MAXIMUM (preferably zero - pure JSON only)

REQUIRED JSON STRUCTURE (use EXACTLY this format):
{
  "biome": "arctic|forest|desert|city|room|default",
  "objects": {
    "tree": {"count": 5, "colors": {"leaves": "#4BBB6D", "trunk": "#8b4513"}, "size": "medium", "scale": 1.2, "ordering": "midground"},
    "rock": {"count": 3, "color": "#808080", "size": "small", "scale": 0.8, "ordering": "foreground"},
    "building": {"count": 2, "color": "#C0C0C0", "size": "large", "scale": 2.0, "ordering": "background"},
    "mountain": {"count": 1, "color": "#696969", "size": "large", "scale": 3.0, "ordering": "background"},
    "street_lamp": {"count": 0, "color": "#FFD700", "size": "small", "scale": 1.0},
    "chair": {"count": 2, "color": "#8B4513", "size": "medium", "scale": 1.0, "ordering": "foreground"},
    "couch": {"count": 1, "color": "#A0522D", "size": "large", "scale": 2.0, "ordering": "midground"}
  },
  "terrain": {"type": "flat|hilly|mountainous|indoor", "elevation": "low|medium|high", "color": "#HEX"},
  "sky": {"color": "#HEX"},
  "colors": {"palette": ["#HEX", "#HEX", "#HEX"], "ground": "#HEX", "ambient": "#HEX"},
  "spatial_layout": [
    {"object_type": "tree", "position": "foreground|midground|background", "layer": 1, "density": "sparse|medium|dense", "size_order": 1}
  ],
  "weather": "clear|cloudy|rainy|snowy|foggy"
}

COLOR EXTRACTION RULES:
- Analyze dominant colors in the image and convert to hex IMMEDIATELY
- For furniture/interior: Extract wall colors, floor colors, object colors as hex codes (e.g., "#F5F5DC" not "beige")
- For trees: Extract leaf color (#RRGGBB) and trunk color (#RRGGBB)
- For buildings: Extract wall/roof colors as hex codes
- NEVER return color names - ALWAYS convert to hex before returning

IMPORTANT: IGNORE ALL HUMANS, PEOPLE, AND LIVING CREATURES IN THE IMAGE. Do not count or analyze human objects, faces, bodies, or any living beings. Focus only on the environment, furniture, structures, terrain, and inanimate objects.

VALIDATION: Before returning, verify ALL color values start with "#" and are 6 hex digits (e.g., "#FF5733"). If any color is not in hex format, convert it.

DO NOT include any text, descriptions, or explanations. Return ONLY the JSON object."""
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
            max_tokens=2000,
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


async def analyze_video_with_overshoot(video_base64: str) -> Optional[Dict]:
    """
    Analyze VIDEO using Overshoot AI.
    This sends the full video data to Overshoot for analysis.
    
    Args:
        video_base64: Base64 encoded video data (with or without data URL prefix)
    
    Returns:
        Dict with analysis results or None if failed
    """
    if not OVERSHOOT_API_KEY:
        print("[OVERSHOOT VIDEO] ❌ OVERSHOOT_API_KEY not set - cannot analyze video")
        return None
    
    try:
        # Remove data URL prefix if present (e.g., "data:video/webm;base64,")
        video_data = video_base64
        if ',' in video_base64:
            video_data = video_base64.split(',')[1]
        
        headers = {
            "Authorization": f"Bearer {OVERSHOOT_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # Detailed prompt for video analysis - return JSON
        json_prompt = """Analyze this video and identify the environment shown. Return ONLY a valid JSON object:
{
  "biome": "arctic|forest|desert|city|room|default",
  "objects": {
    "tree": {"count": 0, "colors": {"leaves": "#HEX", "trunk": "#HEX"}},
    "rock": {"count": 0, "color": "#HEX"},
    "building": {"count": 0, "color": "#HEX"},
    "mountain": {"count": 0, "color": "#HEX"},
    "chair": {"count": 0, "color": "#HEX"},
    "couch": {"count": 0, "color": "#HEX"},
    "table": {"count": 0, "color": "#HEX"}
  },
  "terrain": {"type": "flat|hilly|mountainous|indoor", "color": "#HEX"},
  "sky": {"color": "#HEX"},
  "colors": {"palette": ["#HEX", "#HEX", "#HEX"]},
  "weather": "clear|cloudy|rainy|snowy|foggy"
}

RULES:
1. Return ONLY valid JSON - no text, no explanations
2. ALL colors MUST be hex format (#RRGGBB)
3. Count visible objects accurately across all frames
4. Ignore humans/people in the video
5. Focus on environment, furniture, and structures
6. Analyze the entire video duration"""
        
        # Overshoot video analysis endpoint
        video_api_url = OVERSHOOT_API_URL.replace('/v0.2', '/v0.2/video') if '/v0.2' in OVERSHOOT_API_URL else f"{OVERSHOOT_API_URL}/video"
        
        payload = {
            "video": video_data,
            "prompt": json_prompt,
            "analysis_type": "video_environment_scan",
            "response_format": "json",
            "features": [
                "object_detection",
                "terrain_classification", 
                "weather_detection",
                "color_palette",
                "spatial_relationships",
                "temporal_analysis"
            ]
        }
        
        print(f"[OVERSHOOT VIDEO] 📹 Analyzing video with Overshoot AI...")
        print(f"[OVERSHOOT VIDEO] API URL: {video_api_url}")
        print(f"[OVERSHOOT VIDEO] Video data size: {len(video_data)} characters")
        print(f"[OVERSHOOT VIDEO] API Key: {OVERSHOOT_API_KEY[:10]}..." if OVERSHOOT_API_KEY else "[OVERSHOOT VIDEO] No API key")
        
        response = requests.post(
            video_api_url,
            headers=headers,
            json=payload,
            timeout=60  # Longer timeout for video
        )
        
        if response.status_code == 200:
            result = response.json()
            print(f"[OVERSHOOT VIDEO] ✅ Successfully analyzed video")
            print(f"[OVERSHOOT VIDEO] Response: {str(result)[:500]}")
            return parse_overshoot_response(result)
        elif response.status_code == 404:
            print(f"[OVERSHOOT VIDEO] ⚠️ Video endpoint not found (404)")
            print(f"[OVERSHOOT VIDEO] Tried URL: {video_api_url}")
            print(f"[OVERSHOOT VIDEO] Overshoot may not support video upload - try their streaming SDK instead")
            return None
        elif response.status_code == 401:
            print(f"[OVERSHOOT VIDEO] ❌ Authentication failed (401). Check OVERSHOOT_API_KEY.")
            return None
        elif response.status_code == 413:
            print(f"[OVERSHOOT VIDEO] ❌ Video too large (413). Try a shorter recording.")
            return None
        else:
            print(f"[OVERSHOOT VIDEO] API returned status {response.status_code}: {response.text[:500]}")
            return None
            
    except requests.exceptions.Timeout:
        print(f"[OVERSHOOT VIDEO] ⚠️ Request timed out after 60 seconds")
        return None
    except requests.exceptions.ConnectionError as e:
        print(f"[OVERSHOOT VIDEO] ❌ Connection error: {e}")
        return None
    except Exception as e:
        print(f"[OVERSHOOT VIDEO] Error analyzing video: {e}")
        import traceback
        traceback.print_exc()
        return None


async def analyze_environment(image_data: str) -> Dict:
    """
    Analyze environment image using OpenAI Vision API.
    
    NOTE: For single image/frame analysis, use OpenAI Vision.
          For video analysis, use analyze_video_with_overshoot() instead.
    
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
    # Use OpenAI Vision for single image/frame analysis
    print(f"[OPENAI] Analyzing image with OpenAI Vision...")
    openai_result = await analyze_with_openai_vision(image_data)
    if openai_result:
        print("[OPENAI] ✅ Image analyzed successfully")
        return openai_result
    
    # If OpenAI Vision failed and no API key set, use fallback
    if not OPENAI_API_KEY:
        print("[VISION] ❌ OPENAI_API_KEY not set - using fallback mode")
        print("[VISION] To use real AI analysis, set OPENAI_API_KEY in .env")
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
    
    # OpenAI failed - return None
    print("[OPENAI] ❌ OpenAI Vision analysis failed")
    print(f"[OPENAI] OPENAI_API_KEY present: {OPENAI_API_KEY is not None}")
    return None


def validate_and_convert_colors(color_value: any) -> Optional[str]:
    """
    Validate and convert color values to hex format.
    Returns hex string if valid, None otherwise.
    """
    if not color_value:
        return None
    
    # If already a valid hex string
    if isinstance(color_value, str):
        color_str = color_value.strip()
        # Check if it's already a valid hex color
        if color_str.startswith("#") and len(color_str) == 7:
            try:
                # Validate hex digits
                int(color_str[1:], 16)
                return color_str.upper()
            except ValueError:
                pass
    
    # Color name to hex mapping (common cases)
    color_map = {
        "light lavender": "#E6E6FA",
        "pale purple": "#DDA0DD",
        "bright blue": "#4169E1",
        "warm white": "#FFF8DC",
        "beige": "#F5F5DC",
        "light blue": "#ADD8E6",
        "dark blue": "#00008B",
        "white": "#FFFFFF",
        "black": "#000000",
        "gray": "#808080",
        "grey": "#808080",
        "brown": "#A52A2A",
        "red": "#FF0000",
        "green": "#008000",
        "blue": "#0000FF",
        "yellow": "#FFFF00",
        "orange": "#FFA500",
        "purple": "#800080"
    }
    
    if isinstance(color_value, str):
        color_lower = color_value.lower().strip()
        if color_lower in color_map:
            return color_map[color_lower]
    
    # If we can't convert, return None
    print(f"[COLOR VALIDATION] Could not convert color value: {color_value}")
    return None


def generate_creative_object_from_type(obj_type: str, count: int, color: Optional[str] = None, position: Optional[Dict] = None) -> List[Dict]:
    """
    Generate creative_objects format from furniture type.
    Returns list of creative object definitions.
    """
    creative_objects = []
    
    # Default color if not provided
    default_color = color if color else "#808080"
    
    for i in range(count):
        # Generate random position if not provided
        if not position:
            pos = {
                "x": random.uniform(-80, 80),
                "y": 0,
                "z": random.uniform(-80, 80)
            }
        else:
            pos = position
        
        obj_lower = obj_type.lower()
        
        if obj_lower in ["chair", "chairs"]:
            # Chair: seat (box) + back (box) + legs (4 cylinders)
            creative_obj = {
                "name": f"chair_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    # Seat
                    {"shape": "box", "position": {"x": 0, "y": 0.3, "z": 0}, "dimensions": {"width": 1.0, "height": 0.1, "depth": 1.0}, "color": default_color},
                    # Back
                    {"shape": "box", "position": {"x": 0, "y": 0.75, "z": -0.4}, "dimensions": {"width": 1.0, "height": 0.9, "depth": 0.1}, "color": default_color},
                    # Legs (4)
                    {"shape": "cylinder", "position": {"x": -0.4, "y": 0.15, "z": -0.4}, "radius": 0.05, "height": 0.3, "color": default_color},
                    {"shape": "cylinder", "position": {"x": 0.4, "y": 0.15, "z": -0.4}, "radius": 0.05, "height": 0.3, "color": default_color},
                    {"shape": "cylinder", "position": {"x": -0.4, "y": 0.15, "z": 0.4}, "radius": 0.05, "height": 0.3, "color": default_color},
                    {"shape": "cylinder", "position": {"x": 0.4, "y": 0.15, "z": 0.4}, "radius": 0.05, "height": 0.3, "color": default_color}
                ]
            }
        elif obj_lower in ["couch", "sofa", "couches", "sofas"]:
            # Couch: seat (long box) + back (long box) + armrests (2 boxes)
            creative_obj = {
                "name": f"couch_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    # Seat
                    {"shape": "box", "position": {"x": 0, "y": 0.35, "z": 0}, "dimensions": {"width": 3.0, "height": 0.2, "depth": 1.2}, "color": default_color},
                    # Back
                    {"shape": "box", "position": {"x": 0, "y": 0.8, "z": -0.5}, "dimensions": {"width": 3.0, "height": 0.9, "depth": 0.2}, "color": default_color},
                    # Left armrest
                    {"shape": "box", "position": {"x": -1.4, "y": 0.6, "z": 0}, "dimensions": {"width": 0.3, "height": 0.5, "depth": 1.2}, "color": default_color},
                    # Right armrest
                    {"shape": "box", "position": {"x": 1.4, "y": 0.6, "z": 0}, "dimensions": {"width": 0.3, "height": 0.5, "depth": 1.2}, "color": default_color}
                ]
            }
        elif obj_lower in ["bed", "beds"]:
            # Bed: mattress (box) + headboard (box)
            creative_obj = {
                "name": f"bed_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    # Mattress
                    {"shape": "box", "position": {"x": 0, "y": 0.2, "z": 0}, "dimensions": {"width": 2.0, "height": 0.3, "depth": 3.0}, "color": default_color},
                    # Headboard
                    {"shape": "box", "position": {"x": 0, "y": 0.6, "z": -1.3}, "dimensions": {"width": 2.2, "height": 0.8, "depth": 0.2}, "color": default_color}
                ]
            }
        elif obj_lower in ["table", "tables"]:
            # Table: top (box) + legs (4 cylinders)
            creative_obj = {
                "name": f"table_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    # Top
                    {"shape": "box", "position": {"x": 0, "y": 0.75, "z": 0}, "dimensions": {"width": 2.0, "height": 0.1, "depth": 1.5}, "color": default_color},
                    # Legs (4)
                    {"shape": "cylinder", "position": {"x": -0.9, "y": 0.375, "z": -0.65}, "radius": 0.08, "height": 0.75, "color": default_color},
                    {"shape": "cylinder", "position": {"x": 0.9, "y": 0.375, "z": -0.65}, "radius": 0.08, "height": 0.75, "color": default_color},
                    {"shape": "cylinder", "position": {"x": -0.9, "y": 0.375, "z": 0.65}, "radius": 0.08, "height": 0.75, "color": default_color},
                    {"shape": "cylinder", "position": {"x": 0.9, "y": 0.375, "z": 0.65}, "radius": 0.08, "height": 0.75, "color": default_color}
                ]
            }
        elif obj_lower in ["desk", "desks"]:
            # Desk: similar to table but with drawers
            creative_obj = {
                "name": f"desk_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    # Top
                    {"shape": "box", "position": {"x": 0, "y": 0.75, "z": 0}, "dimensions": {"width": 2.5, "height": 0.1, "depth": 1.2}, "color": default_color},
                    # Drawer unit (left)
                    {"shape": "box", "position": {"x": -0.9, "y": 0.4, "z": -0.4}, "dimensions": {"width": 0.8, "height": 0.7, "depth": 0.5}, "color": default_color},
                    # Legs (right side)
                    {"shape": "cylinder", "position": {"x": 1.0, "y": 0.375, "z": -0.5}, "radius": 0.08, "height": 0.75, "color": default_color},
                    {"shape": "cylinder", "position": {"x": 1.0, "y": 0.375, "z": 0.5}, "radius": 0.08, "height": 0.75, "color": default_color}
                ]
            }
        else:
            # Default: simple box for unknown furniture types
            creative_obj = {
                "name": f"{obj_type}_{i+1}",
                "position": pos,
                "scale": 1.0,
                "parts": [
                    {"shape": "box", "position": {"x": 0, "y": 0.5, "z": 0}, "dimensions": {"width": 1.5, "height": 1.0, "depth": 1.5}, "color": default_color}
                ]
            }
        
        creative_objects.append(creative_obj)
    
    return creative_objects


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
    
    # Furniture types that should become creative_objects
    FURNITURE_TYPES = {"chair", "chairs", "couch", "couches", "sofa", "sofas", "bed", "beds", "table", "tables", "desk", "desks"}
    
    # Extract objects - handle different formats (new technical format with colors/sizes)
    objects = {}
    furniture_objects = {}  # Track furniture separately for creative_objects
    objects_data = raw_response.get("objects", [])
    object_colors_dict = {}
    
    if isinstance(objects_data, list):
        for obj in objects_data:
            if isinstance(obj, dict):
                obj_type_str = obj.get("type") or obj.get("name") or obj.get("object_type")
                if obj_type_str:
                    obj_type_lower = obj_type_str.lower().strip()
                    # Check if it's furniture
                    if obj_type_lower in FURNITURE_TYPES:
                        count = obj.get("count") or obj.get("quantity") or 1
                        furniture_objects[obj_type_str] = count
                        # Extract color
                        if "colors" in obj:
                            color_val = obj["colors"]
                            if isinstance(color_val, dict):
                                color_val = color_val.get("color") or color_val.get("general")
                            object_colors_dict[obj_type_str] = validate_and_convert_colors(color_val)
                    else:
                        # Regular object mapping
                        obj_type = map_object_type(obj_type_str)
                        if obj_type:
                            count = obj.get("count") or obj.get("quantity") or 1
                            objects[obj_type] = objects.get(obj_type, 0) + count
                            # Extract colors for regular objects
                            if "colors" in obj:
                                obj_colors = obj["colors"]
                                if isinstance(obj_colors, dict):
                                    object_colors_dict[obj_type] = obj_colors
                                elif isinstance(obj_colors, str):
                                    object_colors_dict[obj_type] = {"color": validate_and_convert_colors(obj_colors)}
            elif isinstance(obj, str):
                obj_type_lower = obj.lower().strip()
                if obj_type_lower in FURNITURE_TYPES:
                    furniture_objects[obj] = furniture_objects.get(obj, 0) + 1
                else:
                    obj_type = map_object_type(obj)
                    if obj_type:
                        objects[obj_type] = objects.get(obj_type, 0) + 1
    elif isinstance(objects_data, dict):
        # Handle NEW technical format: {"tree": {"count": 5, "colors": {...}, ...}}
        for obj_type_str, obj_data in objects_data.items():
            obj_type_lower = obj_type_str.lower().strip()
            # Check if it's furniture
            if obj_type_lower in FURNITURE_TYPES:
                if isinstance(obj_data, dict):
                    count = obj_data.get("count") or obj_data.get("quantity") or 1
                    furniture_objects[obj_type_str] = count
                    # Extract color
                    color_val = obj_data.get("color") or obj_data.get("colors")
                    if isinstance(color_val, dict):
                        color_val = color_val.get("color") or color_val.get("general")
                    object_colors_dict[obj_type_str] = validate_and_convert_colors(color_val)
                elif isinstance(obj_data, (int, float)):
                    furniture_objects[obj_type_str] = int(obj_data)
            else:
                # Regular object mapping
                obj_type = map_object_type(obj_type_str)
                if obj_type:
                    if isinstance(obj_data, dict):
                        count = obj_data.get("count") or obj_data.get("quantity") or 1
                        objects[obj_type] = count
                        
                        # Extract object-specific colors and store
                        color_val = obj_data.get("color") or obj_data.get("colors")
                        if color_val:
                            if isinstance(color_val, dict):
                                # Validate colors in dict
                                validated_colors = {}
                                for k, v in color_val.items():
                                    validated_colors[k] = validate_and_convert_colors(v) or v
                                object_colors_dict[obj_type] = validated_colors
                            elif isinstance(color_val, str):
                                object_colors_dict[obj_type] = {"color": validate_and_convert_colors(color_val)}
                    elif isinstance(obj_data, (int, float)):
                        objects[obj_type] = int(obj_data)
    
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
    
    # Extract colors for structures - handle different formats and validate
    colors_data = raw_response.get("colors", {})
    if isinstance(colors_data, list):
        color_palette = [validate_and_convert_colors(c) or c for c in colors_data if c]
    elif isinstance(colors_data, dict):
        palette = colors_data.get("palette") or colors_data.get("dominant")
        if isinstance(palette, list):
            color_palette = [validate_and_convert_colors(c) or c for c in palette if c]
        elif isinstance(palette, str):
            validated = validate_and_convert_colors(palette)
            color_palette = [validated] if validated else []
        else:
            color_palette = []
    elif isinstance(colors_data, str):
        validated = validate_and_convert_colors(colors_data)
        color_palette = [validated] if validated else []
    elif isinstance(colors_data, (int, float)):
        # Skip numeric colors (not valid hex)
        color_palette = []
    else:
        color_palette = []
    
    # Extract spatial layout for positioning
    spatial_layout = raw_response.get("spatial_layout", [])
    if not isinstance(spatial_layout, list):
        spatial_layout = []
    
    # Extract colors from spatial_layout if available
    for layout_item in spatial_layout:
        if isinstance(layout_item, dict):
            layout_obj_type = layout_item.get("object_type") or layout_item.get("object")
            if layout_obj_type and "color" in layout_item:
                color_val = layout_item["color"]
                validated = validate_and_convert_colors(color_val)
                if validated:
                    object_colors_dict[layout_obj_type] = {"color": validated}
    
    # Extract terrain and sky colors
    terrain_color = terrain_data.get("color")
    if terrain_color:
        validated = validate_and_convert_colors(terrain_color)
        if validated:
            object_colors_dict["terrain"] = {"color": validated}
    
    sky_data = raw_response.get("sky", {})
    if isinstance(sky_data, dict):
        sky_color = sky_data.get("color")
        if sky_color:
            validated = validate_and_convert_colors(sky_color)
            if validated:
                object_colors_dict["sky"] = {"color": validated}
    elif isinstance(sky_data, str):
        validated = validate_and_convert_colors(sky_data)
        if validated:
            object_colors_dict["sky"] = {"color": validated}
    
    # Generate creative_objects for furniture
    creative_objects = []
    # #region agent log
    try:
        import json
        with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"overshoot_integration.py:655","message":"Generating creative_objects from furniture","data":{"furniture_objects":str(furniture_objects),"furniture_count":len(furniture_objects) if isinstance(furniture_objects, dict) else "not_dict"},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"H1"})+'\n')
    except: pass
    # #endregion
    for furniture_type, count in furniture_objects.items():
        # #region agent log
        try:
            import json
            with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location":"overshoot_integration.py:662","message":"Processing furniture item","data":{"furniture_type":furniture_type,"count":count,"count_type":str(type(count)),"furniture_color":str(object_colors_dict.get(furniture_type))[:50]},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"H1"})+'\n')
        except: pass
        # #endregion
        # Ensure count is an integer
        if not isinstance(count, (int, float)):
            count = int(count) if count else 1
        count = int(count)
        furniture_color = object_colors_dict.get(furniture_type)
        furniture_creative = generate_creative_object_from_type(
            furniture_type, 
            count, 
            color=furniture_color
        )
        # #region agent log
        try:
            import json
            with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
                f.write(json.dumps({"location":"overshoot_integration.py:678","message":"Generated creative_objects","data":{"furniture_type":furniture_type,"generated_count":len(furniture_creative) if isinstance(furniture_creative, list) else "not_list","total_creative_objects":len(creative_objects)},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"H1"})+'\n')
        except: pass
        # #endregion
        creative_objects.extend(furniture_creative)
    
    # #region agent log
    try:
        import json
        with open('c:\\Projects\\NexHacks26\\.cursor\\debug.log', 'a', encoding='utf-8') as f:
            f.write(json.dumps({"location":"overshoot_integration.py:681","message":"Final result preparation","data":{"creative_objects_type":str(type(creative_objects)),"creative_objects_len":len(creative_objects) if isinstance(creative_objects, list) else "not_list","color_palette_type":str(type(color_palette)),"color_palette_len":len(color_palette) if isinstance(color_palette, list) else "not_list"},"timestamp":int(__import__('time').time()*1000),"sessionId":"debug-session","runId":"run1","hypothesisId":"H1,H4"})+'\n')
    except: pass
    # #endregion
    result = {
        "biome": biome,
        "objects": objects,
        "colors": color_palette,
        "spatial_layout": spatial_layout,
        "weather": weather_data.get("condition") or weather_data.get("type") or "clear",
        "terrain_type": terrain_data.get("type") or terrain_data.get("name") or "flat",
        "object_colors": object_colors_dict,  # Validated hex colors
        "creative_objects": creative_objects if creative_objects else []  # Generated furniture - always return list, never None
    }
    
    if creative_objects:
        print(f"[OVERSHOOT] Generated {len(creative_objects)} creative_objects from furniture")
    
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
    
    # Check for room/indoor biomes first
    if any(keyword in terrain_lower for keyword in ["room", "indoor", "interior", "inside", "bedroom", "living room", "kitchen", "bathroom"]):
        return "room"
    
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
