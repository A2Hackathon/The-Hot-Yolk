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
    Returns: dict with biome, time, structure, enemy_count, weapon (mechanic)
    
    Uses file-based cache to avoid repeated LLM calls for the same prompt.
    """
    try:
        client = get_groq_client()
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": """Extract world parameters from the user's prompt and return ONLY a JSON object.

IMPORTANT RULES:
1. Biome detection:
   - If prompt contains: "arctic", "ice", "icy", "snow", "frozen", "winter", "cold" → biome: "arctic"
   - If prompt contains: "city", "urban", "town", "street" → biome: "city"
   - Otherwise → biome: "default"

2. Time detection:
   - If prompt contains: "sunset", "dusk", "evening", "orange sky" → time: "sunset"
   - If prompt contains: "night", "dark", "midnight" → time: "night"
   - Otherwise → time: "noon"

3. Enemy count:
   - Extract number before "enemies" or "enemy"
   - If not mentioned → 5
   - Range: 0-10

4. Weapon/mechanic:
   - If mentions "jump", "stomp", "bounce", "double jump" → weapon: "double_jump"
   - If mentions "dash", "rush", "charge" → weapon: "dash"
   - If mentions "no combat", "no attack", "peaceful" → weapon: "none"
   - Otherwise → weapon: "dash"

5. Structures (optional):
   - Extract counts for: trees, rocks, buildings, mountains, hills, rivers, street_lamps
   - Look for patterns like "3 trees", "5 rocks", "10 buildings", etc.
   - IMPORTANT: If user says "trees" (plural) without a number, use biome-specific default:
     * Arctic biome: 25 trees (default)
     * Other biomes (city, default): 10 trees (default)
   - If structure type is NOT mentioned at all, don't include that key (will use defaults)
   - Examples:
     * "give me 3 trees" → structure: {"tree": 3}
     * "trees" or "with trees" → structure: {"tree": 25} for arctic, {"tree": 10} for others
     * "5 trees and 2 rocks" → structure: {"tree": 5, "rock": 2}
     * "city with 10 buildings" → structure: {"building": 10}
     * "arctic with trees" → structure: {"tree": 25}  // Arctic default
     * "city with trees" → structure: {"tree": 10}  // City default

Return ONLY this JSON structure (no markdown, no backticks, no explanation):
{
  "biome": "arctic"|"city"|"default",
  "time": "noon"|"sunset"|"night",
  "enemy_count": 3-8,
  "weapon": "double_jump"|"dash"|"none",
  "structure": {}
}

IMPORTANT: Only include structure keys that are explicitly mentioned with numbers OR when plural form is used (e.g., "trees" = 25).
If a structure type is not mentioned at all, omit it from the structure object entirely."""
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=300
        )
        
        result = completion.choices[0].message.content.strip()
        
        print(f"[PARSER DEBUG] Raw LLM response: {result}")
        
        # Clean markdown code blocks
        if "```" in result:
            result = result.split("```")[1].replace("json", "").strip()
        
        params = json.loads(result)
        
        # Validate and set defaults
        params.setdefault("biome", "city")
        params.setdefault("time", "noon")
        params.setdefault("enemy_count", 5)
        params.setdefault("weapon", "dash")
        params.setdefault("structure", {})
        
        # Normalize biome
        if params["biome"] not in ["arctic", "city", "default"]:
            params["biome"] = "city"
        
        # Normalize time
        if params["time"] not in ["noon", "sunset", "night"]:
            params["time"] = "noon"
        
        # Validate weapon
        if params["weapon"] not in ["double_jump", "dash", "none"]:
            params["weapon"] = "dash"
        
        # Clamp enemy count
        params["enemy_count"] =  min(10, params["enemy_count"])
        
        print(f"[PARSER DEBUG] Final params: {params}")
        
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
    Simple keyword-based parser as fallback
    """
    prompt_lower = prompt.lower()
    
    # Detect biome
    if any(word in prompt_lower for word in ["arctic", "ice", "icy", "snow", "frozen", "winter", "cold"]):
        biome = "arctic"
    elif any(word in prompt_lower for word in ["city", "urban", "town", "street"]):
        biome = "city"
    else:
        biome = "default"
    
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
    
    result = {
        "biome": biome,
        "time": time,
        "enemy_count": min(10, enemy_count),
        "weapon": weapon,
        "structure": structure
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