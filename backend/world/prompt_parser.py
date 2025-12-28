from groq import Groq
import json
import os

client = Groq(api_key=os.environ.get("GROQ_API_KEY"))

def parse_prompt(prompt: str) -> dict:
    """prompt parsing with Groq"""
    try:
        completion = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": """Extract world params as JSON:
{"biome": "city"|"arctic", "time": "noon"|"sunset"|"night", "structure": {}, "enemy_count": 3-8, "weapon": "fists"|"staff"|"pulse"|"none"}
Return ONLY valid JSON, no explanation."""
                },
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            max_tokens=200
        )
        
        result = completion.choices[0].message.content.strip()
        if "```" in result:
            result = result.split("```")[1].replace("json", "").strip()
        
        params = json.loads(result)
        params.setdefault("biome", "city")
        params.setdefault("time", "noon")
        params.setdefault("enemy_count", 5)
        params.setdefault("weapon", "fists")
        params.setdefault("structure", {})
        params["enemy_count"] = max(3, min(8, params["enemy_count"]))
        
        return params
    except:
        return {"biome": "city", "time": "noon", "structure": {}, "enemy_count": 5, "weapon": "fists"}