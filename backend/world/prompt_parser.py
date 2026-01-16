from groq import Groq
import json
import os
import re
import hashlib
import time
from pathlib import Path


# Cache configuration
CACHE_DIR = Path(__file__).parent.parent / "cache"
CACHE_FILE = CACHE_DIR / "prompt_cache.json"
CACHE_MAX_SIZE = 500  # Maximum number of cached entries
CACHE_TTL_DAYS = 30  # Cache entries expire after 30 days

# In-memory cache (loaded from file on startup)
_prompt_cache = {}
_cache_loaded = False


def get_groq_client():
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not found in environment variables")
    return Groq(api_key=api_key)


def normalize_prompt(prompt: str) -> str:
    """
    Normalize prompt for consistent cache key generation.
    Lowercase, trim, normalize whitespace.
    """
    normalized = " ".join(prompt.lower().strip().split())
    return normalized


def get_cache_key(prompt: str) -> str:
    """
    Generate cache key from normalized prompt.
    Uses SHA256 hash for consistent, short keys.
    """
    normalized = normalize_prompt(prompt)
    return hashlib.sha256(normalized.encode()).hexdigest()[:16]


def load_cache() -> dict:
    """
    Load cache from JSON file.
    Returns empty dict if file doesn't exist or is invalid.
    """
    global _prompt_cache, _cache_loaded
    
    if _cache_loaded:
        return _prompt_cache
    
    try:
        if CACHE_FILE.exists():
            with open(CACHE_FILE, 'r', encoding='utf-8') as f:
                _prompt_cache = json.load(f)
            print(f"[CACHE] Loaded {len(_prompt_cache)} entries from cache file")
        else:
            _prompt_cache = {}
            print("[CACHE] Cache file not found, starting with empty cache")
    except Exception as e:
        print(f"[CACHE] Error loading cache: {e}, starting with empty cache")
        _prompt_cache = {}
    
    _cache_loaded = True
    return _prompt_cache


def save_cache():
    """
    Save cache to JSON file.
    Creates cache directory if it doesn't exist.
    """
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        
        with open(CACHE_FILE, 'w', encoding='utf-8') as f:
            json.dump(_prompt_cache, f, indent=2, ensure_ascii=False)
        
        print(f"[CACHE] Saved {len(_prompt_cache)} entries to cache file")
    except Exception as e:
        print(f"[CACHE] Error saving cache: {e}")


def cleanup_cache():
    """
    Remove expired entries and limit cache size.
    Expires entries older than CACHE_TTL_DAYS.
    Evicts oldest entries if cache exceeds CACHE_MAX_SIZE.
    """
    current_time = time.time()
    ttl_seconds = CACHE_TTL_DAYS * 24 * 60 * 60
    
    # Remove expired entries
    expired_keys = []
    for key, entry in _prompt_cache.items():
        entry_time = entry.get("timestamp", 0)
        if current_time - entry_time > ttl_seconds:
            expired_keys.append(key)
    
    for key in expired_keys:
        del _prompt_cache[key]
    
    if expired_keys:
        print(f"[CACHE] Removed {len(expired_keys)} expired entries")
    
    # Evict oldest entries if cache is too large
    if len(_prompt_cache) > CACHE_MAX_SIZE:
        # Sort by timestamp (oldest first)
        sorted_entries = sorted(
            _prompt_cache.items(),
            key=lambda x: x[1].get("timestamp", 0)
        )
        
        # Remove oldest entries
        to_remove = len(_prompt_cache) - CACHE_MAX_SIZE
        for i in range(to_remove):
            del _prompt_cache[sorted_entries[i][0]]
        
        print(f"[CACHE] Evicted {to_remove} oldest entries (cache size limit)")


def get_from_cache(prompt: str) -> dict:
    """
    Get parsed parameters from cache if available.
    Returns None if not cached or expired.
    """
    cache = load_cache()
    cache_key = get_cache_key(prompt)
    
    if cache_key in cache:
        entry = cache[cache_key]
        entry["hit_count"] = entry.get("hit_count", 0) + 1
        entry["last_accessed"] = time.time()
        
        print(f"[CACHE] ✓ Cache HIT for prompt: '{prompt[:50]}...'")
        return entry.get("params")
    
    print(f"[CACHE] ✗ Cache MISS for prompt: '{prompt[:50]}...'")
    return None


def save_to_cache(prompt: str, params: dict):
    """
    Save parsed parameters to cache.
    """
    cache = load_cache()
    cache_key = get_cache_key(prompt)
    
    cache[cache_key] = {
        "params": params,
        "timestamp": time.time(),
        "hit_count": 0,
        "last_accessed": time.time(),
        "prompt_preview": prompt[:100]  # Store preview for debugging
    }
    
    # Cleanup before saving
    cleanup_cache()
    
    # Save to file
    save_cache()
    
    print(f"[CACHE] Saved to cache: '{prompt[:50]}...'")

def parse_prompt(prompt: str) -> dict:
    """
    Parse user prompt to extract world parameters.
    UNIVERSAL WORLD CREATOR: Converts ANY text into a valid world.
    If user writes gibberish, nonsense, or anything - still create a world.
    
    Uses file-based cache to avoid repeated LLM calls for the same prompt.
    """
    try:
        client = get_groq_client()
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": """You are a UNIVERSAL WORLD CREATOR. Your job is to turn ANYTHING into a 3D world.

CRITICAL RULES:
1. NEVER say you can't create something - ALWAYS generate valid world parameters
2. If the input is unclear/gibberish/random → Be CREATIVE and imaginative
3. If input is just one word → Interpret it creatively as a world theme
4. If input makes no sense → Create a surreal/abstract world based on the vibe
5. ALWAYS return valid JSON, no matter what the input is

UNIVERSAL INTERPRETATION EXAMPLES:
- "asdfgh" → Create abstract/glitch world with random colors
- "pizza" → Create food-themed world with pizza terrain/buildings
- "!@#$%" → Create chaotic/abstract world with wild colors
- "meow" → Create cat-themed world with cat structures
- "123" → Create numerical/matrix world with grid patterns
- "rainbow" → Create colorful world with rainbow gradients
- "dream" → Create dreamy/surreal world with pastel colors
- "" (empty) → Create random surprise world
- "zzzzz" → Create sleepy/dreamlike world with soft colors
- "hello" → Create friendly/welcoming world with warm colors

BIOME EXTRACTION STRATEGY:
1. Look for ANY keywords that suggest a theme/environment
2. If no clear theme → Use the TEXT ITSELF as inspiration for biome name
3. Get creative: colors, emotions, objects, sounds can ALL become biomes
4. Examples of creative biome naming:
  * "lava world" → biome: "lava"
  * "futuristic city" → biome: "futuristic"
  * "underwater ocean" → biome: "underwater"
  * "space station" → biome: "space"
  * "candy land" → biome: "candy"
  * "cyberpunk city" → biome: "cyberpunk"
  * "desert wasteland" → biome: "desert"
  * "jungle rainforest" → biome: "jungle"
  * "volcanic island" → biome: "volcanic"
  * "ice cave" → biome: "ice_cave"
  * "neon city" → biome: "neon"
  * "post-apocalyptic" → biome: "apocalyptic"
  * "pizza" → biome: "pizza_world"
  * "rainbow" → biome: "rainbow"
  * "glitch" → biome: "glitch"
  * "dream" → biome: "dreamscape"
  * "chaos" → biome: "chaotic"
  * "matrix" → biome: "matrix"
  * "retro" → biome: "retro_80s"
  * "minecraft" → biome: "blocky"
  * "steampunk" → biome: "steampunk"

COLOR PALETTE GENERATION:
- ALWAYS include a color_palette (3-5 hex colors)
- Base colors on the biome theme
- Be CREATIVE with color choices
- Examples:
  * "lava" → ["#FF4500", "#FF6347", "#8B0000"]
  * "rainbow" → ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF"]
  * "pizza" → ["#FFD700", "#FF6347", "#FFFACD"]
  * "dream" → ["#FFB6C1", "#E6E6FA", "#F0E68C"]
  * "glitch" → ["#00FF00", "#FF00FF", "#00FFFF"]

TIME DETECTION:
- Extract: "sunset", "dusk", "evening", "night", "midnight", "dawn", "noon"
- If no time mentioned → "noon"
- Creative: "twilight", "golden hour", "witching hour" are valid too

STRUCTURE DETECTION - CONTEXT-AWARE INTELLIGENCE:
Your job is to interpret the prompt and suggest RELEVANT structures that make sense for the world described.

CRITICAL: Support for CUSTOM OBJECTS (creative_objects):
- If the user asks for ANY object NOT in basic structures (trees, rocks, buildings, peaks, street_lamps, enemies), 
  you MUST use "creative_objects" to create it from basic shapes (box, cylinder, sphere, cone, torus)
- Examples: "cars", "chairs", "statues", "vehicles", "furniture", "controllers", "gadgets", "robots", "monuments", "neon signs", "flying cars"
- If user says "with cars", "with flying cars", "with neon signs", "with statues" → CREATE them as creative_objects!
- Format creative_objects as an array of objects, each with: name, position {x, y, z}, parts [{shape, position, dimensions/radius, color}]
- For generation, place creative_objects at appropriate positions on the terrain (use random positions between -100 to 100 for x/z, y=0 for ground level)
- Generate 3-5 instances of each creative object type for variety
- DO NOT say you can't create something - use creative_objects instead!

1. ANALYZE THE PROMPT CONTEXT:
   - What kind of world is being described?
   - What structures would naturally exist in this world?
   - What fits the theme and makes the world feel authentic?

2. SUGGEST RELEVANT STRUCTURES based on biome/theme:
   - UNDERWATER/OCEAN: Suggest rocks (coral formations), mountains (sea mounts), but NO trees or buildings
   - SPACE/GALAXY: Suggest rocks (asteroids), mountains (planetary features), but NO trees or buildings
   - DESERT: Suggest rocks, mountains (dunes), but FEW trees (maybe 3-5 cacti-like)
   - JUNGLE/FOREST: Suggest MANY trees (30-50), rocks, mountains
   - ARCTIC/ICE: Suggest trees (leafless pines, 25-30), rocks, mountains (ice peaks)
   - CITY/URBAN: Suggest buildings (15-20), street_lamps (3-5), FEW trees (5-10), FEW rocks
   - FUTURISTIC/CYBERPUNK: Suggest buildings (20+), street_lamps (5-8), rocks (tech debris), mountains (tech structures)
   - LAVA/VOLCANIC: Suggest rocks (lava rocks, 20-30), mountains (volcano peaks, 5-10), NO trees
   - CANDY/FOOD: Suggest creative structures (food-themed), rocks (candy rocks), but interpret creatively
   - APOCALYPTIC: Suggest rocks (debris, 30+), mountains (ruins), FEW buildings (5-10 broken), NO trees or street_lamps
   - RAINBOW/COLORFUL: Suggest trees (colorful, 20-30), rocks (colorful, 15-25), mountains (colorful peaks)
   - DREAM/FANTASY: Suggest trees (dreamy, 15-25), rocks (magical crystals), mountains (floating islands)

3. STRUCTURE COUNT GUIDELINES:
   - Be generous with structures that fit the theme
   - Be sparse with structures that don't fit
   - Always provide specific counts in the "structure" field
   - Format: {"tree": 25, "rock": 20, "mountain": 5, "building": 15, "street_lamp": 3}
   - If a structure doesn't fit the theme, set it to 0 or omit it

4. INTERPRET USER INTENT:
   - "underwater world" → rocks: 30, mountain: 5, tree: 0, building: 0
   - "space station" → rocks: 20, mountain: 3, tree: 0, building: 15
   - "futuristic city" → building: 25, street_lamp: 8, rock: 10, tree: 5, mountain: 0
   - "lava world" → rock: 35, mountain: 8, tree: 0, building: 0
   - "jungle adventure" → tree: 50, rock: 15, mountain: 3, building: 0
   - "arctic tundra" → tree: 30 (leafless), rock: 20, mountain: 5, building: 0
   - "rainbow paradise" → tree: 30, rock: 25, mountain: 3, building: 0

5. EXAMPLES OF SMART INTERPRETATION:
   - "I want to explore an underwater reef" → biome: "underwater", structure: {"rock": 40, "mountain": 8, "tree": 0, "building": 0}
   - "Build me a cyberpunk city" → biome: "futuristic", structure: {"building": 30, "street_lamp": 10, "rock": 15, "tree": 3, "mountain": 0}
   - "Take me to a lava planet" → biome: "lava", structure: {"rock": 45, "mountain": 12, "tree": 0, "building": 0}
   - "I want a peaceful forest" → biome: "jungle", structure: {"tree": 40, "rock": 10, "mountain": 2, "building": 0}
   - "Show me the arctic" → biome: "arctic", structure: {"tree": 30, "rock": 25, "mountain": 5, "building": 0}

REMEMBER: Your structure suggestions should make the world feel authentic and relevant to what the user asked for!

CREATIVE FALLBACKS:
- If input is gibberish → Create "abstract" or "glitch" world
- If input is emoji → Create world based on emoji meaning
- If input is empty → Create "surprise" random world
- If input is very short → Use it as biome name directly

ENEMY COUNT: 0-10 (default: 5)
WEAPON: "double_jump", "dash", "none" (default: "dash")

Return ONLY this JSON structure (NO markdown, NO backticks):
{
  "biome": "ANY_THEME",
  "biome_description": "Creative description of this world",
  "time": "noon"|"sunset"|"night",
  "enemy_count": 0-10,
  "weapon": "double_jump"|"dash"|"none",
  "structure": {
    "tree": <number>,
    "rock": <number>,
    "mountain": <number>,
    "building": <number>,
    "street_lamp": <number>
  },
  "creative_objects": [     // OPTIONAL: Custom objects built from shapes (cars, chairs, statues, etc.)
    {
      "name": "car",
      "position": {"x": 10.0, "y": 0.0, "z": 20.0},
      "rotation": {"x": 0, "y": 0, "z": 0},
      "scale": 1.0,
      "parts": [
        {
          "shape": "box",
          "position": {"x": 0, "y": 0.5, "z": 0},
          "dimensions": {"width": 2.0, "height": 0.8, "depth": 4.0},
          "color": "#FF0000"
        }
      ]
    }
  ],
  "color_palette": ["#HEX", "#HEX", ...],
  "special_effects": ["effect1", "effect2"]
}

REMEMBER: 
- NEVER refuse to create a world. Turn ANYTHING into valid parameters!
- If user asks for custom objects (cars, chairs, statues, vehicles, furniture, robots, etc.), use "creative_objects" to build them from shapes!
"""
                },
                {"role": "user", "content": prompt if prompt and prompt.strip() else "surprise me with a random world"}
            ],
            temperature=0.5,  # Increased for better context understanding
            max_tokens=800  # More tokens for detailed structure suggestions
        )
        
        result = completion.choices[0].message.content.strip()
        
        print(f"[PARSER DEBUG] Raw LLM response: {result}")
        
        # Clean markdown code blocks
        if "```" in result:
            result = result.split("```")[1].replace("json", "").strip()
        
        params = json.loads(result)
        
        # Validate and set defaults
        params.setdefault("biome", "default")
        params.setdefault("time", "noon")
        params.setdefault("enemy_count", 5)
        params.setdefault("weapon", "dash")
        params.setdefault("structure", {})
        params.setdefault("creative_objects", [])  # Support custom objects during generation
        params.setdefault("color_palette", [])
        params.setdefault("special_effects", [])
        params.setdefault("biome_description", "")
        
        # If color_palette is empty or missing, use default palette for known biomes
        if not params.get("color_palette") or len(params.get("color_palette", [])) == 0:
            default_palettes = {
                "futuristic": ["#1a1a2e", "#16213e", "#0f3460", "#00d4ff", "#ff00ff"],  # Dark cyberpunk
                "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
                "space": ["#000033", "#1a1a3a", "#2d2d5a", "#000080"],
                "lava": ["#FF4500", "#FF6347", "#FF0000", "#8B0000"],
                "solar": ["#FFD700", "#FFA500", "#FF6347", "#FF0000"],
            }
            biome_lower = params["biome"].lower()
            if biome_lower in default_palettes:
                params["color_palette"] = default_palettes[biome_lower]
                print(f"[PARSER] Applied default color palette for '{params['biome']}': {params['color_palette']}")
        
        # Clamp enemy count (no biome restriction - accept ANY biome name)
        params["enemy_count"] = max(0, min(10, params["enemy_count"]))
        
        # Normalize time (still validate)
        if params["time"] not in ["noon", "sunset", "night"]:
            params["time"] = "noon"
        
        # Validate weapon
        if params["weapon"] not in ["double_jump", "dash", "none"]:
            params["weapon"] = "dash"
        
        print(f"[PARSER] Detected biome: '{params['biome']}' with colors: {params.get('color_palette', [])}")
        
        # Save to cache
        try:
            save_to_cache(prompt, params)
        except Exception as cache_error:
            print(f"[CACHE] Warning: Failed to save to cache: {cache_error}")
        
        return params
        
    except Exception as e:
        print(f"[Parser] Error: {e}, using fallback parser")
        # FALLBACK: Simple keyword matching
        return fallback_parse(prompt)

def fallback_parse(prompt: str) -> dict:
    """
    Enhanced fallback parser with keyword detection for ANY biome.
    """
    import re
    prompt_lower = prompt.lower() if prompt else ""
    
    # Dynamic biome detection based on keywords (expanded list)
    biome_keywords = {
        "rainbow": ["rainbow", "colorful", "multicolor", "prismatic"],
        "lava": ["lava", "magma", "volcanic", "volcano", "molten"],
        "futuristic": ["futuristic", "future", "sci-fi", "tech", "cyberpunk", "neon"],
        "underwater": ["underwater", "ocean", "sea", "aquatic", "coral", "reef"],
        "space": ["space", "galaxy", "cosmos", "stellar", "planetary", "sun", "solar"],
        "desert": ["desert", "sand", "dunes", "wasteland", "arid"],
        "jungle": ["jungle", "rainforest", "tropical", "dense forest"],
        "ice": ["ice", "frozen", "glacial", "tundra"],
        "candy": ["candy", "sweet", "chocolate", "sugar"],
        "apocalyptic": ["apocalyptic", "post-apocalyptic", "wasteland", "ruins"],
        "crystal": ["crystal", "gem", "crystalline", "mineral"],
        "arctic": ["arctic", "snow", "winter", "cold"],
        "city": ["city", "urban", "town", "street"]
    }
    
    # Find matching biome
    biome = "default"
    for biome_type, keywords in biome_keywords.items():
        if any(keyword in prompt_lower for keyword in keywords):
            biome = biome_type
            break
    
    # Generate default color palette based on detected biome
    default_palettes = {
        "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
        "space": ["#000033", "#1a1a3a", "#2d2d5a", "#000080"],
        "lava": ["#FF4500", "#FF6347", "#FF0000", "#8B0000"],
        "futuristic": ["#1a1a2e", "#16213e", "#0f3460", "#00d4ff", "#ff00ff"],  # Dark cyberpunk: dark blue/black base with cyan/pink neon
        "solar": ["#FFD700", "#FFA500", "#FF6347", "#FF0000"],
        "sun": ["#FFD700", "#FFA500", "#FFFF00", "#FF8C00"]
    }
    
    color_palette = default_palettes.get(biome, [])
    
    # If no match and prompt exists, use first word or "mystery"
    if biome == "default" and prompt and prompt.strip():
        # Try to extract meaningful word
        words = prompt.strip().split()
        if words:
            # Use first word as biome inspiration (lowercase, alphanumeric only)
            first_word = re.sub(r'[^a-z0-9]', '', words[0].lower())
            if first_word and len(first_word) > 2:
                biome = f"{first_word}_world"
                # Generate color palette for unknown biomes
                if not color_palette:
                    color_palette = []
            else:
                biome = "mystery_world"
        else:
            biome = "mystery_world"
    
    # Detect time
    if any(word in prompt_lower for word in ["sunset", "dusk", "evening", "orange"]):
        time = "sunset"
    elif any(word in prompt_lower for word in ["night", "dark", "midnight"]):
        time = "night"
    else:
        time = "noon"
    
    # Detect enemy count
    enemy_count = 5
    enemy_match = re.search(r'(\d+)\s*enem', prompt_lower)
    if enemy_match:
        enemy_count = int(enemy_match.group(1))
    
    # Detect weapon
    if any(word in prompt_lower for word in ["jump", "stomp", "bounce"]):
        weapon = "double_jump"
    elif any(word in prompt_lower for word in ["dash", "rush", "charge"]):
        weapon = "dash"
    elif any(word in prompt_lower for word in ["no combat", "peaceful"]):
        weapon = "none"
    else:
        weapon = "dash"
    
    # Extract structure counts
    import re
    structure = {}
    
    # Extract tree count
    tree_match = re.search(r'(\d+)\s*tree', prompt_lower)
    if tree_match:
        structure["tree"] = int(tree_match.group(1))
    elif re.search(r'\btrees\b', prompt_lower):
        # If "trees" (plural) is mentioned without a number, use biome-specific default
        # Arctic: 25, Others: 10
        if biome == "arctic":
            structure["tree"] = 25
        else:
            structure["tree"] = 10
    
    # Extract rock count
    rock_match = re.search(r'(\d+)\s*rock', prompt_lower)
    if rock_match:
        structure["rock"] = int(rock_match.group(1))
    
    # Extract building count
    building_match = re.search(r'(\d+)\s*(?:building|house|houses)', prompt_lower)
    if building_match:
        structure["building"] = int(building_match.group(1))
    
    # Extract mountain count
    mountain_match = re.search(r'(\d+)\s*mountain', prompt_lower)
    if mountain_match:
        structure["mountain"] = int(mountain_match.group(1))
    
    # Extract street lamp count
    lamp_match = re.search(r'(\d+)\s*(?:street\s*)?lamp', prompt_lower)
    if lamp_match:
        structure["street_lamp"] = int(lamp_match.group(1))
    
    # Get default color palette for this biome
    default_palettes = {
        "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
        "space": ["#000033", "#1a1a3a", "#2d2d5a", "#000080"],
        "sun": ["#000033", "#1a1a3a", "#2d2d5a"],
        "lava": ["#FF4500", "#FF6347", "#FF0000", "#8B0000"],
        "futuristic": ["#1a1a2e", "#16213e", "#0f3460", "#00d4ff", "#ff00ff"],  # Dark cyberpunk: dark blue/black base with cyan/pink neon
        "solar": ["#FFD700", "#FFA500", "#FF6347", "#FF0000"],
        "sun_world": ["#FFD700", "#FFA500", "#FFFF00", "#FF8C00"],
        "make_world": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF"]  # Rainbow for make_world
    }
    
    # Use palette if biome matches, otherwise empty (will use hash-based colors)
    color_palette = default_palettes.get(biome, [])
    
    # Special case: if biome ends with "_world" and we have a matching base biome, use its palette
    if not color_palette and biome.endswith("_world"):
        base_biome = biome.replace("_world", "")
        if base_biome in default_palettes:
            color_palette = default_palettes[base_biome]
    
    # Add context-aware structure defaults if structure dict is empty or incomplete
    biome_structure_defaults = {
        "underwater": {"rock": 40, "mountain": 8, "tree": 0, "building": 0, "street_lamp": 0},
        "ocean": {"rock": 40, "mountain": 8, "tree": 0, "building": 0, "street_lamp": 0},
        "space": {"rock": 20, "mountain": 3, "tree": 0, "building": 15, "street_lamp": 0},
        "galaxy": {"rock": 20, "mountain": 3, "tree": 0, "building": 15, "street_lamp": 0},
        "futuristic": {"building": 25, "street_lamp": 8, "rock": 10, "tree": 5, "mountain": 0},
        "cyberpunk": {"building": 30, "street_lamp": 10, "rock": 15, "tree": 3, "mountain": 0},
        "city": {"building": 20, "street_lamp": 5, "rock": 8, "tree": 8, "mountain": 0},
        "lava": {"rock": 45, "mountain": 12, "tree": 0, "building": 0, "street_lamp": 0},
        "volcanic": {"rock": 45, "mountain": 12, "tree": 0, "building": 0, "street_lamp": 0},
        "jungle": {"tree": 50, "rock": 15, "mountain": 3, "building": 0, "street_lamp": 0},
        "rainforest": {"tree": 50, "rock": 15, "mountain": 3, "building": 0, "street_lamp": 0},
        "arctic": {"tree": 30, "rock": 25, "mountain": 5, "building": 0, "street_lamp": 0},
        "winter": {"tree": 30, "rock": 25, "mountain": 5, "building": 0, "street_lamp": 0},
        "ice": {"tree": 30, "rock": 25, "mountain": 5, "building": 0, "street_lamp": 0},
        "desert": {"rock": 25, "mountain": 5, "tree": 3, "building": 0, "street_lamp": 0},
        "apocalyptic": {"rock": 35, "mountain": 5, "tree": 0, "building": 8, "street_lamp": 0},
        "rainbow": {"tree": 30, "rock": 25, "mountain": 3, "building": 0, "street_lamp": 0},
        "candy": {"tree": 20, "rock": 20, "mountain": 2, "building": 0, "street_lamp": 0},
    }
    
    # Apply biome-specific defaults if structure dict is empty or missing keys
    if not structure or len(structure) == 0:
        structure = biome_structure_defaults.get(biome.lower(), {
            "tree": 15,
            "rock": 20,
            "mountain": 3,
            "building": 0,
            "street_lamp": 0
        })
    else:
        # Merge defaults with extracted values
        defaults = biome_structure_defaults.get(biome.lower(), {})
        for key, default_value in defaults.items():
            if key not in structure:
                structure[key] = default_value
    
    result = {
        "biome": biome,
        "time": time,
        "enemy_count": min(10, enemy_count),
        "weapon": weapon,
        "structure": structure,
        "color_palette": color_palette,
        "special_effects": [],
        "biome_description": f"A {biome} world with contextually appropriate structures"
    }
    
    print(f"[FALLBACK PARSER] Result: {result}")
    return result

def extract_mechanic_from_command(command: str) -> str:
    """
    Extract mechanic change from live voice command
    Used for real-time modifications like "switch to dash"
    
    Args:
        command: Voice command string
    
    Returns:
        "double_jump", "dash", "none", or None if not a mechanic change
    """
    command_lower = command.lower()
    
    # Check for no combat
    if any(word in command_lower for word in ["no combat", "no attack", "disable combat", "none"]):
        return "none"
    
    # Check for dash keywords
    if any(word in command_lower for word in ["dash", "rush", "charge", "speed attack"]):
        return "dash"
    
    # Check for jump keywords
    if any(word in command_lower for word in ["double jump", "stomp", "bounce", "jump attack", "mario"]):
        return "double_jump"
    
    return None


# Test
if __name__ == "__main__":
    from dotenv import load_dotenv
    load_dotenv()
    
    test_prompts = [
        "city with trees at sunset",
        "arctic mountains with trees",
        "snowy place with double jump and 5 enemies",
        "city at night with 8 enemies"
    ]
    
    print("=== Testing Parser ===\n")
    for prompt in test_prompts:
        result = parse_prompt(prompt)
        print(f"'{prompt}'")
        print(f"  → {result['biome']}, {result['time']}, {result['enemy_count']} enemies, {result['weapon']}")
        print()