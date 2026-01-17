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
    Returns None if not cached or expired, OR if cached result is wrong.
    """
    cache = load_cache()
    cache_key = get_cache_key(prompt)
    
    if cache_key in cache:
        entry = cache[cache_key]
        cached_params = entry.get("params", {})
        cached_biome = cached_params.get("biome", "").lower() if cached_params else ""
        prompt_lower = prompt.lower() if prompt else ""
        
        # Check if cached biome is wrong for specific locations
        force_mappings = {
            "gotham": ["gotham", "batman"],
            "metropolis": ["metropolis", "superman"],
            "tokyo": ["tokyo", "japan"],
            "venice": ["venice", "italy"],
            "paris": ["paris", "france"],
            "spiderman_world": ["spider", "spiderman"],
            "lava": ["lava", "magma", "volcanic", "volcano", "molten"]
        }
        
        for target_biome, keywords in force_mappings.items():
            if any(keyword in prompt_lower for keyword in keywords):
                if cached_biome != target_biome:
                    print(f"[CACHE] 🚫 Cache REJECTED: Prompt '{prompt}' expects '{target_biome}' but cache has '{cached_biome}' - DELETING")
                    # Delete bad cache entry from both in-memory and disk
                    try:
                        load_cache()  # Reload to get latest _prompt_cache
                        if cache_key in _prompt_cache:
                            del _prompt_cache[cache_key]
                            save_cache()  # Persist deletion
                            print(f"[CACHE] ✅ Deleted bad cache entry from disk")
                    except Exception as e:
                        print(f"[CACHE] Error deleting: {e}")
                    return None  # Don't return bad cache
        
        # Cache is valid, return it
        entry["hit_count"] = entry.get("hit_count", 0) + 1
        entry["last_accessed"] = time.time()
        print(f"[CACHE] ✓ Cache HIT for prompt: '{prompt[:50]}...' (biome: '{cached_biome}')")
        return cached_params
    
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
    # Check cache first
    cached = get_from_cache(prompt)
    if cached:
        # ALWAYS post-process cached results to fix bad biomes
        prompt_lower = prompt.lower() if prompt else ""
        cached_biome = cached.get("biome", "").lower()
        
        # Force correct biome if cached has wrong one
        force_mappings = {
            "gotham": ["gotham", "batman"],
            "metropolis": ["metropolis", "superman"],
            "tokyo": ["tokyo", "japan"],
            "venice": ["venice", "italy"],
            "paris": ["paris", "france"],
            "spiderman_world": ["spider", "spiderman"]
        }
        
        corrected = False
        for target_biome, keywords in force_mappings.items():
            if any(keyword in prompt_lower for keyword in keywords):
                if cached_biome != target_biome:
                    print(f"[PARSER] ⚠️ BAD CACHE DETECTED: User wrote '{prompt}' but cache has '{cached_biome}' (should be '{target_biome}') - DELETING CACHE AND RE-PARSING")
                    corrected = True
                    # Delete bad cache entry from disk
                    try:
                        cache_key = get_cache_key(prompt)
                        # Reload cache from disk to ensure we have latest
                        load_cache()
                        if cache_key in _prompt_cache:
                            del _prompt_cache[cache_key]
                            save_cache()
                            print(f"[PARSER] ✅ Deleted bad cache entry '{cache_key}' from disk")
                    except Exception as e:
                        print(f"[PARSER] Error deleting cache: {e}")
                    # DON'T use cached - re-parse with AI
                    break
        
        # If cache was bad, re-parse with AI
        if corrected:
            print(f"[PARSER] Re-parsing with AI since cache had wrong biome...")
            cached = None  # Clear cached so we don't accidentally use it
        else:
            # Even if cached biome looks OK, still check if it matches prompt
            final_prompt_check = prompt.lower() if prompt else ""
            cached_biome_final = cached.get("biome", "").lower()
            
            final_force_map = {
                "gotham": ["gotham", "batman"],
                "metropolis": ["metropolis", "superman"],
                "tokyo": ["tokyo", "japan"],
                "venice": ["venice", "italy"],
                "paris": ["paris", "france"],
                "spiderman_world": ["spider", "spiderman"],
                "lava": ["lava", "magma", "volcanic", "volcano", "molten"]
            }
            
            for target_biome, keywords in final_force_map.items():
                if any(keyword in final_prompt_check for keyword in keywords):
                    if cached_biome_final != target_biome:
                        print(f"[PARSER] 🔴 CACHED RESULT WRONG: User wrote '{prompt}' (expecting '{target_biome}') but cache has '{cached_biome_final}' - FORCING CORRECTION")
                        cached["biome"] = target_biome
                        if target_biome == "gotham":
                            cached["time"] = "night"
                            cached["color_palette"] = []
                            print(f"[PARSER] ✅ CORRECTED CACHED: biome='gotham', time='night', colors=[]")
                        # Delete bad cache and re-parse
                        try:
                            cache_key = get_cache_key(prompt)
                            # Delete from both in-memory cache and disk
                            load_cache()  # Reload to get latest from disk
                            if cache_key in _prompt_cache:
                                del _prompt_cache[cache_key]
                                save_cache()  # Save deletion to disk
                                print(f"[PARSER] ✅ Deleted bad cache entry from disk")
                        except Exception as e:
                            print(f"[PARSER] Warning: Could not delete cache: {e}")
                        # DON'T return cached - continue to re-parse below
                        break
                    else:
                        # Cache is correct - use it
                        print(f"[PARSER] ✅ Cache is correct: biome='{cached_biome_final}' matches prompt '{prompt}'")
                        return cached
            
            # If we didn't find a match in force_mappings, check one more time before returning
            if cached:
                # Final safety check - if cached biome is "city" or "default" and prompt contains specific location, don't use cache
                final_biome_check = cached.get("biome", "").lower()
                if final_biome_check in ["default", "city"]:
                    for target_biome, keywords in force_mappings.items():
                        if any(keyword in prompt_lower for keyword in keywords):
                            print(f"[PARSER] 🔴 FINAL SAFETY: Cached has '{final_biome_check}' for prompt '{prompt}' - NOT USING CACHE")
                            cached = None  # Don't use cache
                            break
                
                if cached:  # Only return if cache is valid
                    return cached
            
            # If we get here, cache was bad or didn't exist - continue to AI parsing below
    
    try:
        # PRE-CHECK: If user wrote a specific location, add explicit instruction to AI
        prompt_lower = prompt.lower() if prompt else ""
        force_mappings = {
            "gotham": ["gotham", "batman"],
            "metropolis": ["metropolis", "superman"],
            "tokyo": ["tokyo", "japan"],
            "venice": ["venice", "italy"],
            "paris": ["paris", "france"],
            "spiderman_world": ["spider", "spiderman"],
            "lava": ["lava", "magma", "volcanic", "volcano", "molten"]
        }
        
        target_biome = None
        for biome_name, keywords in force_mappings.items():
            if any(keyword in prompt_lower for keyword in keywords):
                target_biome = biome_name
                print(f"[PARSER] 🎯 PRE-CHECK: User wrote '{prompt}' → forcing AI to use biome '{target_biome}'")
                break
        
        client = get_groq_client()
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": """You are a UNIVERSAL WORLD CREATOR. Your job is to turn ANYTHING into a 3D world that MATCHES THE EXACT PROMPT the user wrote.

CRITICAL RULES:
1. NEVER say you can't create something - ALWAYS generate valid world parameters
2. Use the USER'S EXACT WORDS - if they say "gotham", use biome: "gotham" (NOT "city")
3. Generate colors based on WHAT THE USER WROTE, not generic biomes
4. If the input references a REAL LOCATION, CHARACTER, MOVIE, GAME, or THEME → Research and use its ACTUAL visual characteristics
5. DON'T convert specific locations to generic biomes - "gotham" stays "gotham", not "city"
6. If the input is unclear/gibberish/random → Be CREATIVE and imaginative
7. ALWAYS return valid JSON, no matter what the input is
8. ALWAYS generate EXACTLY 2 distinct types of "creative_objects" that are NOT standard biome objects (trees, rocks, etc.). These must be deduced from the biome name and prompt.

IMPORTANT: 
- User wrote: "gotham" → biome: "gotham" (NOT "city"), generate DARK colors based on Gotham's visual identity
- User wrote: "tokyo" → biome: "tokyo" (NOT "city"), generate NEON colors based on Tokyo's visual identity  
- User wrote: "metropolis" → biome: "metropolis" (NOT "city"), generate BRIGHT colors based on Metropolis's visual identity
- Use the EXACT location/character name from the user's prompt as the biome name!
- ALWAYS generate 2 creative objects (e.g., for "gotham": "bat_signal", "gargoyle")

THEME RESEARCH & CONTEXTUAL AWARENESS:
When user mentions a location/character/theme, USE YOUR KNOWLEDGE to generate authentic settings:

EXAMPLES OF THEME-AWARE GENERATION:
- "gotham" → 
  * Colors: Dark (#000000, #1a1a1a, #2d2d2d, #4a0e4e purple accents) - DARK and gothic
  * Lighting: NIGHT with fog, dim ambient, dramatic shadows
  * Buildings: Gothic architecture (tall, angular, dark stone), many street lamps
  * Time: "night" (always dark in Gotham)
  * NOT just "city" biome!

- "metropolis" / "superman" →
  * Colors: Bright (#FFFFFF, #87CEEB sky blue, #FFD700 gold accents) - BRIGHT and hopeful
  * Lighting: NOON with bright, optimistic feel
  * Buildings: Modern skyscrapers (glass, chrome, futuristic)
  * Time: "noon" (bright and optimistic)

- "spiderman" / "spider-man" →
  * Colors: Red (#DC143C), Blue (#0000FF), White (#FFFFFF), Gray (#808080) - Classic NYC/Spiderman palette
  * Lighting: SUNSET or NOON (NYC street level)
  * Buildings: NYC-style skyscrapers (many, tall, varied heights)
  * Creative objects: Webs, web-shooters
  * Time: "sunset" or "noon"

- "tokyo" →
  * Colors: Neon (#FF00FF, #00FFFF), White, Gray, Red accents - NEON and vibrant
  * Lighting: NIGHT with neon glow, or NOON bright
  * Buildings: Dense urban, many small buildings, neon signs
  * Time: "night" for neon effect

- "venice" →
  * Colors: Blue (#4169E1 water), Beige (#F5F5DC buildings), Orange (#FF8C00 sunset) - WATER and canals
  * Lighting: SUNSET romantic, or NOON bright
  * Buildings: Historic, colorful, along canals (creative_objects: gondolas, bridges)
  * Time: "sunset" for romantic feel

- "paris" →
  * Colors: Cream (#FFFDD0), Blue (#4169E1), Gray (#808080) - Classic European
  * Lighting: SUNSET (golden hour), or NOON
  * Buildings: Classic architecture, Eiffel Tower (creative_objects)
  * Time: "sunset" for romantic Paris

KEY PRINCIPLE: When you see a location/theme name, THINK:
1. What are the VISUAL CHARACTERISTICS? (colors, architecture, time of day)
2. What is the MOOD/ATMOSPHERE? (dark/moody, bright/cheerful, futuristic, historic)
3. What STRUCTURES fit the theme? (Gotham = gothic buildings, Tokyo = dense urban, Venice = canals)
4. What TIME OF DAY matches? (Gotham = night, Metropolis = noon, Paris = sunset)

UNIVERSAL INTERPRETATION EXAMPLES:
- "asdfgh" → Create abstract/glitch world with random colors
- "pizza" → Create food-themed world with pizza terrain/buildings
- "!@#$%" → Create chaotic/abstract world with wild colors
- "meow" → Create cat-themed world with cat structures
- "123" → Create numerical/matrix world with grid patterns
- "rainbow" → Create colorful world with rainbow gradients
- "dream" → Create dreamy/surreal world with pastel colors
- "spiderman" / "spider-man" → Create superhero city (NYC-style) with tall buildings, webs, creative_objects
- "batman" → Create dark Gotham city with gothic buildings, street lamps
- "superman" → Create bright Metropolis with skyscrapers, futuristic buildings
- "" (empty) → Create random surprise world
- "zzzzz" → Create sleepy/dreamlike world with soft colors
- "hello" → Create friendly/welcoming world with warm colors

BIOME EXTRACTION STRATEGY:
1. Look for ANY keywords that suggest a theme/environment
2. If no clear theme → Use the TEXT ITSELF as inspiration for biome name
3. Get creative: colors, emotions, objects, sounds, CHARACTERS, MOVIES, GAMES can ALL become biomes
4. Character/Media examples:
  * "spiderman" / "spider-man" → biome: "spiderman_world" or "superhero_city"
  * "batman" → biome: "gotham" or "dark_city"
  * "superman" → biome: "metropolis" or "hero_city"
  * "minecraft" → biome: "blocky"
  * "pokemon" → biome: "pokemon_world"
  * ANY character name → biome: "{character}_world"
5. Examples of creative biome naming:
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
  * "steampunk" → biome: "steampunk"

COLOR PALETTE GENERATION (AI-GENERATED BASED ON USER'S EXACT WORDS):
- YOU must generate color_palette (3-5 hex colors) based on WHAT THE USER WROTE in their prompt
- Read the user's prompt carefully - if they wrote "gotham", think about Gotham's actual visual characteristics
- Use your knowledge to determine appropriate colors:
  * What are the characteristic colors associated with what the user wrote?
  * What colors appear in source material (comics, movies, real locations) for that specific name?
  * What colors match the mood/atmosphere of that specific location/character?
- Decision process:
  1. Read the user's prompt: "gotham"
  2. Think: What does "gotham" actually look like visually? (Dark, gothic, moody, always night)
  3. Generate: Dark colors that match Gotham's actual appearance (blacks, dark grays, dark purples/blues)
  4. Output: color_palette: ["#000000", "#1a1a1a", "#2d2d2d", "#1a1a3a"] (example - you generate based on your knowledge)
- If user wrote "gotham" → Generate DARK, GOTHIC colors (NOT bright city colors)
- If user wrote "tokyo" → Generate NEON, VIBRANT colors (NOT generic city colors)
- If user wrote "metropolis" → Generate BRIGHT, OPTIMISTIC colors (NOT generic city colors)
- For ANY prompt: Generate colors that match the VISUAL IDENTITY of what the user wrote
- ALWAYS include 3-5 hex colors in color_palette
- Be creative but authentic to the theme's visual identity from your knowledge

TIME DETECTION (THEME-AWARE):
- Extract explicit mentions: "sunset", "dusk", "evening", "night", "midnight", "dawn", "noon"
- If NO time mentioned, use THEME-APPROPRIATE default based on the location/character:
  * "gotham" → ALWAYS "night" (Gotham is always dark/moody)
  * "metropolis" → "noon" (bright and optimistic)
  * "tokyo" → "night" (neon city, best at night) OR "noon" (busy daytime)
  * "venice" / "paris" → "sunset" (romantic golden hour)
  * "spiderman" → "sunset" (NYC street level, dramatic lighting)
  * Generic themes → "noon" (default)
- Creative: "twilight", "golden hour", "witching hour" are valid too
- MATCH THE MOOD: Dark themes = night, Bright themes = noon, Romantic = sunset

STRUCTURE DETECTION - CONTEXT-AWARE INTELLIGENCE:
Your job is to interpret the prompt and suggest RELEVANT structures that make sense for the world described.

CRITICAL: Support for CUSTOM OBJECTS (creative_objects):
- If the user asks for ANY object NOT in basic structures (trees, rocks, buildings, peaks, street_lamps, enemies), 
  you MUST use "creative_objects" to create it from basic shapes (box, cylinder, sphere, cone, torus)
- Examples: "cars", "chairs", "statues", "vehicles", "furniture", "controllers", "gadgets", "robots", "monuments", "neon signs", "flying cars"
- Character/Theme-specific objects:
  * "spiderman" → Create webs (cylinders/tori), skyscrapers, city buildings, web-shooters (creative_objects)
  * "batman" → Create gothic architecture, bat-signals, dark buildings
  * "superman" → Create tall buildings, futuristic structures, hero monuments
- If user says "with cars", "with flying cars", "with neon signs", "with statues", "with webs" → CREATE them as creative_objects!
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

4. INTERPRET USER INTENT (THEME-AWARE):
   - "underwater world" → rocks: 30, mountain: 5, tree: 0, building: 0
   - "space station" → rocks: 20, mountain: 3, tree: 0, building: 15
   - "futuristic city" → building: 25, street_lamp: 8, rock: 10, tree: 5, mountain: 0
   - "lava world" → rock: 35, mountain: 8, tree: 0, building: 0
   - "jungle adventure" → tree: 50, rock: 15, mountain: 3, building: 0
   - "arctic tundra" → tree: 30 (leafless), rock: 20, mountain: 5, building: 0
   - "rainbow paradise" → tree: 30, rock: 25, mountain: 3, building: 0
   - "gotham" → building: 30 (GOTHIC tall/dark), street_lamp: 20 (many), tree: 0, rock: 5, time: "night", colors: YOU generate DARK colors (think: what colors represent Gotham's dark, gothic atmosphere?)
   - "metropolis" → building: 35 (MODERN skyscrapers), street_lamp: 8, tree: 10, rock: 5, time: "noon", colors: YOU generate BRIGHT colors (think: what colors represent Metropolis's bright, optimistic feel?)
   - "tokyo" → building: 40 (DENSE urban), street_lamp: 15, tree: 3, rock: 5, time: "night", colors: YOU generate NEON colors (think: what colors represent Tokyo's neon-lit nightlife?)
   - "venice" → building: 20 (HISTORIC colorful), street_lamp: 0, tree: 5, rock: 0, time: "sunset", colors: YOU generate WATER/ROMANTIC colors (think: water, canals, warm sunset), creative_objects: [gondolas, bridges]
   - "paris" → building: 25 (CLASSIC architecture), street_lamp: 10, tree: 15, rock: 0, time: "sunset", colors: YOU generate ROMANTIC colors (think: elegant European, romantic atmosphere)

5. EXAMPLES OF THEME-AWARE SMART INTERPRETATION:
   - "I want to explore an underwater reef" → biome: "underwater", structure: {"rock": 40, "mountain": 8, "tree": 0, "building": 0}
   - "Build me a cyberpunk city" → biome: "futuristic", structure: {"building": 30, "street_lamp": 10, "rock": 15, "tree": 3, "mountain": 0}, time: "night", colors: NEON cyberpunk palette
   - "Take me to a lava planet" → biome: "lava", structure: {"rock": 45, "mountain": 12, "tree": 0, "building": 0}
   - "I want a peaceful forest" → biome: "jungle", structure: {"tree": 40, "rock": 10, "mountain": 2, "building": 0}
   - "Show me the arctic" → biome: "arctic", structure: {"tree": 30, "rock": 25, "mountain": 5, "building": 0}
   - "spiderman world" → biome: "spiderman_world", structure: {"building": 30, "street_lamp": 10, "tree": 5, "rock": 10}, time: "sunset", colors: YOU generate (think: Spiderman's red/blue costume colors, NYC urban colors), creative_objects: [webs, web-shooters]
   - "gotham" → biome: "gotham", structure: {"building": 30, "street_lamp": 20, "tree": 0, "rock": 5}, time: "night" (ALWAYS), colors: YOU generate DARK GOTHIC colors (think: what colors represent Gotham's dark, moody, gothic atmosphere from comics/movies?)
   - "metropolis" → biome: "metropolis", structure: {"building": 35, "street_lamp": 8, "tree": 10, "rock": 5}, time: "noon" (BRIGHT), colors: YOU generate BRIGHT/HOPEFUL colors (think: what colors represent Metropolis's optimistic, bright, heroic atmosphere?)
   - "tokyo" → biome: "tokyo", structure: {"building": 40, "street_lamp": 15, "tree": 3, "rock": 5}, time: "night", colors: YOU generate NEON VIBRANT colors (think: what colors represent Tokyo's neon-lit streets, vibrant nightlife?)
   - "venice" → biome: "venice", structure: {"building": 20, "street_lamp": 0, "tree": 5, "rock": 0}, time: "sunset", colors: YOU generate WATER/ROMANTIC colors (think: canals, water, warm sunset, historic buildings), creative_objects: [gondolas, bridges, canals]
   - "paris" → biome: "paris", structure: {"building": 25, "street_lamp": 10, "tree": 15, "rock": 0}, time: "sunset", colors: YOU generate ROMANTIC/ELEGANT colors (think: what colors represent Paris's romantic, elegant atmosphere?), creative_objects: [Eiffel Tower]

CRITICAL RULE - USE USER'S EXACT WORDS:
- If user writes "gotham" → biome: "gotham" (NOT "city"), time: "night", colors: YOU generate DARK colors based on Gotham
- If user writes "tokyo" → biome: "tokyo" (NOT "city"), time: "night", colors: YOU generate NEON colors based on Tokyo
- If user writes "metropolis" → biome: "metropolis" (NOT "city"), time: "noon", colors: YOU generate BRIGHT colors based on Metropolis
- If user writes "spiderman" → biome: "spiderman_world" (NOT "city"), colors: YOU generate based on Spiderman/NYC
- NEVER convert specific locations/characters to generic "city" - use the EXACT word the user wrote as the biome name!
- Generate colors based on WHAT THE USER WROTE, not based on a generic "city" interpretation

REMEMBER: Your structure suggestions should make the world feel authentic and relevant to what the user asked for!

CREATIVE FALLBACKS:
- If input is gibberish → Create "abstract" or "glitch" world
- If input is emoji → Create world based on emoji meaning
- If input is empty → Create "surprise" random world
- If input is very short → Use it as biome name directly

ENEMY COUNT: 0-10 (default: 5)
WEAPON: "double_jump", "dash", "none" (default: "dash")

IMPORTANT: Look at what the user ACTUALLY wrote in their prompt and use that EXACT word as the biome name.
- User wrote "gotham" → biome: "gotham" (NOT "city")
- User wrote "tokyo" → biome: "tokyo" (NOT "city")  
- User wrote "metropolis" → biome: "metropolis" (NOT "city")
- Generate colors based on the SPECIFIC location/character the user mentioned, not generic defaults!

Return ONLY this JSON structure (NO markdown, NO backticks):
{
  "biome": "EXACT_WORD_FROM_USER_PROMPT",  // Use what user wrote, not generic "city"
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
  "creative_objects": [     // REQUIRED: EXACTLY 2 creative objects NOT in standard biome
    {
      "name": "bat_signal",
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
    },
    {
      "name": "gargoyle",
      "position": {"x": -15.0, "y": 0.0, "z": 30.0},
      "rotation": {"x": 0, "y": 45, "z": 0},
      "scale": 1.2,
      "parts": [
        {
          "shape": "sphere",
          "position": {"x": 0, "y": 1.0, "z": 0},
          "radius": 0.5,
          "color": "#808080"
        }
      ]
    }
  ],
  "color_palette": ["#HEX", "#HEX", ...],
  "special_effects": ["effect1", "effect2"]
}

REMEMBER: 
- NEVER refuse to create a world. Turn ANYTHING into valid parameters!
- ALWAYS generate EXACTLY 2 creative_objects that are NOT standard biome objects (trees, rocks, buildings, street_lamps, mountains)
- These 2 creative objects MUST be deduced from the biome name and user prompt
- If user asks for custom objects (cars, chairs, statues, vehicles, furniture, robots, etc.), use "creative_objects" to build them from shapes!
- COLORS ARE YOUR RESPONSIBILITY: 
  * Read what the user ACTUALLY wrote (e.g., "gotham")
  * Think about what colors that specific thing actually looks like visually
  * Generate colors that match that specific visual identity
  * Don't default to generic colors - if user wrote "gotham", generate DARK colors, not bright city colors!
- BIOME NAMING: Use the EXACT word/phrase the user wrote, don't convert to generic biomes
"""
                },
                {"role": "user", "content": f"""The user wrote this EXACT prompt: "{prompt if prompt and prompt.strip() else 'surprise me with a random world'}"

{"⚠️ CRITICAL: User wrote a specific location/character. You MUST use the EXACT word as the biome name!" + f" User wrote '{prompt}' → biome MUST be '{target_biome}' (NOT 'city', NOT 'default')" + " Generate DARK colors for Gotham, NEON colors for Tokyo, BRIGHT colors for Metropolis." if target_biome else ""}

CRITICAL INSTRUCTIONS:
1. Use the EXACT word/phrase the user wrote as the biome name
   - If user wrote "gotham" → biome: "gotham" (NOT "city", NOT "default")
   - If user wrote "tokyo" → biome: "tokyo" (NOT "city", NOT "default")
   - NEVER convert specific locations to generic "city" biome!
   
2. Generate colors based on WHAT THE USER WROTE
   - If user wrote "gotham" → Generate DARK, GOTHIC colors (think: Gotham is always dark, moody, gothic) - colors like #000000, #1a1a1a, #2d2d2d
   - If user wrote "tokyo" → Generate NEON colors (think: Tokyo's vibrant neon nightlife) - colors like #FF00FF, #00FFFF
   - Research the visual characteristics of what the user wrote and generate appropriate colors
   
3. Match the visual identity of what the user mentioned
   - Colors, lighting, structures should all match the theme's authentic visual characteristics
   
4. ALWAYS generate EXACTLY 2 creative_objects that are NOT standard biome objects
   - These 2 objects MUST be deduced from the biome name and user prompt
   - Examples: For "gotham" → "bat_signal" and "gargoyle"; For "tokyo" → "neon_sign" and "vending_machine"
   - NEVER include trees, rocks, buildings, street_lamps, or mountains as creative_objects

Create a world that matches the EXACT prompt the user wrote above."""}
            ],
            temperature=0.5,  # Increased for better context understanding
            max_tokens=800  # More tokens for detailed structure suggestions
        )
        
        result = completion.choices[0].message.content.strip()
        
        print(f"[PARSER DEBUG] Raw LLM response: {result}")
        print(f"[PARSER DEBUG] User prompt was: '{prompt}'")
        
        # Clean markdown code blocks
        if "```" in result:
            result = result.split("```")[1].replace("json", "").strip()
        
        params = json.loads(result)
        
        print(f"[PARSER DEBUG] AI returned biome: '{params.get('biome', 'MISSING')}'")
        print(f"[PARSER DEBUG] AI returned time: '{params.get('time', 'MISSING')}'")
        print(f"[PARSER DEBUG] AI returned color_palette: {params.get('color_palette', [])}")
        print(f"[PARSER DEBUG] AI returned structure: {params.get('structure', {})}")
        
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
        
        # If color_palette is empty, only provide fallback for abstract/theoretical biomes that AI might not know
        # For real locations/characters, let AI generate colors based on knowledge
        color_palette_val = params.get("color_palette", [])
        # Ensure color_palette is a list before checking length
        if not color_palette_val or not isinstance(color_palette_val, list) or len(color_palette_val) == 0:
            # Only use fallbacks for abstract/theoretical biomes where AI might not have visual references
            # Real locations/characters should have been generated by AI based on knowledge
            abstract_palettes = {
                "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
                # Note: Removed hardcoded palettes for gotham, metropolis, tokyo, etc. - AI should generate these
            }
            biome_lower = params["biome"].lower()
            if biome_lower in abstract_palettes:
                params["color_palette"] = abstract_palettes[biome_lower]
                print(f"[PARSER] Applied abstract fallback color palette for '{params['biome']}': {params['color_palette']}")
            else:
                # For real locations/themes, log that AI should have provided colors
                print(f"[PARSER] WARNING: No color_palette from AI for '{params['biome']}' - AI should have generated theme-appropriate colors")
        
        # Clamp enemy count (no biome restriction - accept ANY biome name)
        params["enemy_count"] = max(0, min(10, params["enemy_count"]))
        
        # Normalize time (still validate)
        if params["time"] not in ["noon", "sunset", "night"]:
            params["time"] = "noon"
        
        # Validate weapon
        if params["weapon"] not in ["double_jump", "dash", "none"]:
            params["weapon"] = "dash"
        
        print(f"[PARSER] Detected biome: '{params['biome']}' with colors: {params.get('color_palette', [])}")
        print(f"[PARSER] User prompt was: '{prompt}'")
        
        # AGGRESSIVE POST-PROCESSING: Force correct biome based on user prompt
        prompt_lower = prompt.lower() if prompt else ""
        ai_biome = params.get("biome", "").lower()
        
        # DIRECT MAPPING: If user wrote a specific location/character, force that biome
        force_mappings = {
            "gotham": ["gotham", "batman"],
            "metropolis": ["metropolis", "superman"],
            "tokyo": ["tokyo", "japan"],
            "venice": ["venice", "italy"],
            "paris": ["paris", "france"],
            "spiderman_world": ["spider", "spiderman"],
            "lava": ["lava", "magma", "volcanic", "volcano", "molten"]
        }
        
        for target_biome, keywords in force_mappings.items():
            if any(keyword in prompt_lower for keyword in keywords):
                # ALWAYS force correct biome regardless of what AI returned
                if ai_biome != target_biome:
                    print(f"[PARSER] ⚠️ FORCING: User wrote '{prompt}' but AI returned '{ai_biome}' - FORCING biome to '{target_biome}'")
                    params["biome"] = target_biome
                    
                    # Use fallback parser to get correct structure defaults
                    fallback_result = fallback_parse(prompt)
                    if fallback_result.get("structure") and (not params.get("structure") or len(params.get("structure", {})) == 0):
                        params["structure"] = fallback_result.get("structure", {})
                    
                    # Force dark colors for Gotham (empty palette so lighting.py generates dark)
                    if target_biome == "gotham":
                        print(f"[PARSER] 🎨 FORCING: Clearing bright colors for Gotham, leaving empty for lighting.py to generate dark colors")
                        params["color_palette"] = []  # Empty so lighting.py generates dark colors
                        params["time"] = "night"  # Force night for Gotham
                    
                    # Force bright colors for Metropolis
                    elif target_biome == "metropolis":
                        params["color_palette"] = []  # Let lighting.py generate bright colors
                        params["time"] = "noon"  # Force noon for Metropolis
                    
                    print(f"[PARSER] ✅ FORCED: biome='{params['biome']}', time='{params['time']}', colors={params.get('color_palette', [])}")
                    break
        
        # FINAL CHECK: One more pass to ensure correct biome (in case post-processing didn't catch it)
        final_prompt_lower = prompt.lower() if prompt else ""
        final_biome = params.get("biome", "").lower()
        for target_biome, keywords in force_mappings.items():
            if any(keyword in final_prompt_lower for keyword in keywords):
                if final_biome != target_biome:
                    print(f"[PARSER] 🔴 FINAL FIX: Forcing biome '{target_biome}' (was '{final_biome}')")
                    params["biome"] = target_biome
                    if target_biome == "gotham":
                        params["time"] = "night"
                        params["color_palette"] = []
                    break
        
        # Save to cache
        try:
            # Don't cache bad results (e.g., "city" for "gotham")
            prompt_lower = prompt.lower() if prompt else ""
            final_biome = params.get("biome", "").lower()
            
            # Don't cache if AI returned generic biome for specific location
            should_cache = True
            if final_biome in ["default", "city"]:
                specific_locations = ["gotham", "batman", "metropolis", "superman", "tokyo", "venice", "paris", "spider", "spiderman", "lava", "magma", "volcanic", "volcano", "molten"]
                if any(loc in prompt_lower for loc in specific_locations):
                    print(f"[CACHE] ⚠️ Not caching bad result: biome '{final_biome}' for prompt '{prompt}' (should be specific)")
                    should_cache = False
            
            # Try to save to cache only if it's a good result
            if should_cache:
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
        "city": ["city", "urban", "town", "street"],
        "spiderman": ["spiderman", "spider-man", "spider man", "spider", "peter parker"],
        "batman": ["batman", "gotham", "bruce wayne"],
        "superhero": ["superhero", "super hero", "marvel", "dc", "comics"]
    }
    
    # Find matching biome - prioritize exact matches first
    biome = "default"
    
    # First check for exact matches (gotham, metropolis, tokyo, etc.)
    exact_matches = {
        "gotham": "gotham",
        "batman": "gotham",
        "metropolis": "metropolis",
        "superman": "metropolis",
        "tokyo": "tokyo",
        "venice": "venice",
        "paris": "paris",
        "spiderman": "spiderman_world",
        "spider-man": "spiderman_world"
    }
    
    for exact_term, target_biome in exact_matches.items():
        if exact_term in prompt_lower:
            biome = target_biome
            print(f"[FALLBACK] Exact match: '{exact_term}' → biome: '{biome}'")
            break
    
    # If no exact match, use keyword matching
    if biome == "default":
        for biome_type, keywords in biome_keywords.items():
            if any(keyword in prompt_lower for keyword in keywords):
                biome = biome_type
                # Special handling: convert to specific biome names
                if biome_type == "spiderman":
                    biome = "spiderman_world"
                elif biome_type == "batman":
                    biome = "gotham"
                elif biome_type == "metropolis":
                    biome = "metropolis"
                elif biome_type == "tokyo":
                    biome = "tokyo"
                elif biome_type == "venice":
                    biome = "venice"
                elif biome_type == "paris":
                    biome = "paris"
                print(f"[FALLBACK] Keyword match: '{keywords[0]}' → biome: '{biome}'")
                break
    
    # Generate color palette - REMOVED all hardcoded colors for real locations
    # Only provide fallback for truly abstract biomes where AI might not know visual characteristics
    abstract_palettes = {
        "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
        # Note: NO hardcoded colors for gotham, metropolis, tokyo, paris, etc.
        # AI must generate colors based on knowledge of these locations/characters
    }
    
    # Start with empty - AI should have generated colors for ALL real locations/themes
    color_palette = abstract_palettes.get(biome, [])
    
    # If no palette, leave empty - AI should have provided colors based on theme knowledge
    # Don't fall back to hardcoded colors for real locations
    
    # If no match and prompt exists, use first word or "mystery"
    if biome == "default" and prompt and prompt.strip():
        # Try to extract meaningful word
        words = prompt.strip().split()
        if words:
            # Use first word as biome inspiration (lowercase, alphanumeric only)
            first_word = re.sub(r'[^a-z0-9]', '', words[0].lower())
            # Also check if prompt contains character names or themes (check ALL words, not just first)
            prompt_lower_no_spaces = re.sub(r'[^a-z0-9]', '', prompt_lower)
            
            # Check for character/superhero themes (more flexible matching)
            if "spiderman" in prompt_lower_no_spaces or "spiderman" in prompt_lower or "spider" in prompt_lower:
                biome = "spiderman_world"
                structure = {"building": 30, "street_lamp": 10, "tree": 5, "rock": 10, "mountain": 0}
            elif "batman" in prompt_lower_no_spaces or "batman" in prompt_lower:
                biome = "gotham"
                structure = {"building": 25, "street_lamp": 15, "tree": 0, "rock": 5, "mountain": 0}
            elif "superman" in prompt_lower or "metropolis" in prompt_lower:
                biome = "metropolis"
                structure = {"building": 30, "street_lamp": 8, "tree": 5, "rock": 5, "mountain": 0}
            elif first_word and len(first_word) > 2:
                # Use first word as biome name
                biome = f"{first_word}_world"
                # For "spider", override to "spiderman_world" with city structures
                if first_word == "spider":
                    biome = "spiderman_world"
                    structure = {"building": 30, "street_lamp": 10, "tree": 5, "rock": 10, "mountain": 0}
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
    
    # REMOVED hardcoded color palettes - AI should generate colors
    # Only provide fallback for truly abstract/theoretical biomes
    abstract_palettes = {
        "rainbow": ["#FF0000", "#FF7F00", "#FFFF00", "#00FF00", "#0000FF", "#4B0082", "#9400D3"],
        # Note: No hardcoded colors for gotham, metropolis, tokyo, etc. - AI must generate these
    }
    
    # Use palette only for abstract biomes, otherwise empty (AI should have provided colors)
    color_palette = abstract_palettes.get(biome, [])
    
    # Don't provide fallback colors for real locations - leave empty so AI generates them
    
    # Add context-aware structure defaults if structure dict is empty or incomplete
    biome_structure_defaults = {
        "underwater": {"rock": 40, "mountain": 8, "tree": 0, "building": 0, "street_lamp": 0},
        "ocean": {"rock": 40, "mountain": 8, "tree": 0, "building": 0, "street_lamp": 0},
        "space": {"rock": 20, "mountain": 3, "tree": 0, "building": 15, "street_lamp": 0},
        "galaxy": {"rock": 20, "mountain": 3, "tree": 0, "building": 15, "street_lamp": 0},
        "futuristic": {"building": 25, "street_lamp": 8, "rock": 10, "tree": 5, "mountain": 0},
        "cyberpunk": {"building": 30, "street_lamp": 10, "rock": 15, "tree": 3, "mountain": 0},
        "city": {"building": 20, "street_lamp": 5, "rock": 8, "tree": 8, "mountain": 0},
        "spiderman": {"building": 30, "street_lamp": 10, "rock": 10, "tree": 5, "mountain": 0},
        "spiderman_world": {"building": 30, "street_lamp": 10, "rock": 10, "tree": 5, "mountain": 0},
        "spiderman": {"building": 30, "street_lamp": 10, "rock": 10, "tree": 5, "mountain": 0},
        "gotham": {"building": 30, "street_lamp": 20, "rock": 5, "tree": 0, "mountain": 0},
        "batman": {"building": 30, "street_lamp": 20, "rock": 5, "tree": 0, "mountain": 0},
        "metropolis": {"building": 35, "street_lamp": 8, "rock": 5, "tree": 10, "mountain": 0},
        "tokyo": {"building": 40, "street_lamp": 15, "rock": 5, "tree": 3, "mountain": 0},
        "venice": {"building": 20, "street_lamp": 0, "rock": 0, "tree": 5, "mountain": 0},
        "paris": {"building": 25, "street_lamp": 10, "rock": 0, "tree": 15, "mountain": 0},
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
