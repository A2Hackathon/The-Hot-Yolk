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
    Returns:
        dict with biome, time, structure, enemy_count, weapon (mechanic)
    """
    try:
        client = get_groq_client()
        
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": """Extract world params as JSON:
{"biome": "city"|"arctic", "time": "noon"|"sunset"|"night", "structure": {"mountain": int, "hill": int, "river": int}, "enemy_count": 3-8, "weapon": "double_jump"|"dash"|"none"}

Rules:
- weapon: "double_jump" for stomp attacks, "dash" for dash-through attacks, "none" for no combat
- Interpret "jump", "stomp", "bounce" as "double_jump"
- Interpret "dash", "rush", "charge" as "dash"
- If no combat mentioned, default to "dash"

Return ONLY valid JSON, no explanation."""
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=200
        )
        
        result = completion.choices[0].message.content.strip()
        
        # Clean markdown code blocks
        if "```" in result:
            result = result.split("```")[1].replace("json", "").strip()
        
        params = json.loads(result)
        
        # Set defaults
        params.setdefault("biome", "city")
        params.setdefault("time", "noon")
        params.setdefault("enemy_count", 5)
        params.setdefault("weapon", "dash")
        params.setdefault("structure", {})
        
        # Validate weapon
        if params["weapon"] not in ["double_jump", "dash", "none"]:
            params["weapon"] = "dash"
        
        # Clamp enemy count
        params["enemy_count"] = max(3, min(8, params["enemy_count"]))
        
        return params
        
    except Exception as e:
        print(f"[Parser] Error: {e}, using defaults")
        return {
            "biome": "city",
            "time": "noon",
            "structure": {},
            "enemy_count": 5,
            "weapon": "dash"
        }

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
        "arctic city with 5 enemies and dash",
        "snowy place with double jump",
        "city at night with 8 enemies",
        "no combat mode with 3 enemies"
    ]
    
    print("=== Testing Parser ===\n")
    for prompt in test_prompts:
        result = parse_prompt(prompt)
        print(f"'{prompt}'")
        print(f"  → {result['biome']}, {result['time']}, {result['enemy_count']} enemies, {result['weapon']}")
        print()