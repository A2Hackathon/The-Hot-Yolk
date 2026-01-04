from groq import Groq
import json
import os


def get_groq_client():
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise ValueError("GROQ_API_KEY not found in environment variables")
    return Groq(api_key=api_key)

def parse_prompt(prompt: str) -> dict:
    """
    Parse user prompt to extract world parameters.
    Returns: dict with biome, time, structure, enemy_count, weapon (mechanic)
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
   - Range: 3-8

4. Weapon/mechanic:
   - If mentions "jump", "stomp", "bounce", "double jump" → weapon: "double_jump"
   - If mentions "dash", "rush", "charge" → weapon: "dash"
   - If mentions "no combat", "no attack", "peaceful" → weapon: "none"
   - Otherwise → weapon: "dash"

5. Structures (optional):
   - Count of mountains, hills, rivers if mentioned

Return ONLY this JSON structure (no markdown, no backticks, no explanation):
{
  "biome": "arctic"|"city"|"default",
  "time": "noon"|"sunset"|"night",
  "enemy_count": 3-8,
  "weapon": "double_jump"|"dash"|"none",
  "structure": {"mountain": 0, "hill": 0, "river": 0}
}"""
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
        params["enemy_count"] = max(3, min(8, params["enemy_count"]))
        
        print(f"[PARSER DEBUG] Final params: {params}")
        
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
    import re
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
    
    result = {
        "biome": biome,
        "time": time,
        "enemy_count": max(3, min(8, enemy_count)),
        "weapon": weapon,
        "structure": {}
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