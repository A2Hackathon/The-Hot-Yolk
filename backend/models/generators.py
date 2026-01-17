"""
3D Model Generation Integrations
Supports multiple 3D generation APIs with fallback options.
"""
import os
import requests
import asyncio
from typing import Optional, Dict, List
import json

# API Configuration
STABILITY_AI_API_KEY = os.getenv("STABILITY_AI_API_KEY")
LUMA_AI_API_KEY = os.getenv("LUMA_AI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Cache for AI-generated templates (persist across requests)
_ai_template_cache: Dict[str, Dict] = {}


async def generate_object_template_with_ai(object_name: str) -> Optional[Dict]:
    """
    Use AI to generate a 3D object template using primitive shapes.
    The AI designs how the object should look using boxes, cylinders, spheres, and cones.
    
    Returns:
        Dict with 'parts' array and 'scale' value, or None if failed
    """
    global _ai_template_cache
    
    # Check cache first
    cache_key = object_name.lower().replace(" ", "_").replace("-", "_")
    if cache_key in _ai_template_cache:
        print(f"[AI Template] Using cached template for '{object_name}'")
        return _ai_template_cache[cache_key]
    
    # Try OpenRouter first, then OpenAI
    api_key = OPENROUTER_API_KEY or OPENAI_API_KEY
    if not api_key:
        print(f"[AI Template] No API key available (need OPENROUTER_API_KEY or OPENAI_API_KEY)")
        return None
    
    # Use OpenRouter if available, otherwise OpenAI
    if OPENROUTER_API_KEY:
        api_url = "https://openrouter.ai/api/v1/chat/completions"
        model = "openai/gpt-4o-mini"  # Fast and cheap
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost:5173",
        }
    else:
        api_url = "https://api.openai.com/v1/chat/completions"
        model = "gpt-4o-mini"
        headers = {
            "Authorization": f"Bearer {OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }
    
    prompt = f"""Design a simple 3D model of a "{object_name}" using only these primitive shapes: box, cylinder, sphere, cone.

The object should be recognizable but simplified (like a low-poly game asset). Use realistic colors.

Return ONLY a valid JSON object with this exact structure (no markdown, no explanation):
{{
  "parts": [
    {{"shape": "box", "position": {{"x": 0, "y": 0.5, "z": 0}}, "dimensions": {{"width": 1, "height": 1, "depth": 1}}, "color": "#HEXCOLOR"}},
    {{"shape": "cylinder", "position": {{"x": 0, "y": 0, "z": 0}}, "radius": 0.5, "height": 1, "color": "#HEXCOLOR"}},
    {{"shape": "sphere", "position": {{"x": 0, "y": 0, "z": 0}}, "radius": 0.5, "color": "#HEXCOLOR"}},
    {{"shape": "cone", "position": {{"x": 0, "y": 0, "z": 0}}, "radius": 0.5, "height": 1, "color": "#HEXCOLOR"}}
  ],
  "scale": 1.0
}}

Rules:
- Position y=0 is ground level, build upward
- Keep total size reasonable (fits in ~1-2 meter cube)
- Use 2-8 parts to create a recognizable shape
- Use realistic hex colors for materials
- The object should sit on the ground (lowest y position near 0)"""

    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are a 3D modeler. Output ONLY valid JSON, no explanations."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.7,
        "max_tokens": 800
    }
    
    try:
        print(f"[AI Template] 🤖 Generating template for '{object_name}'...")
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 200:
            result = response.json()
            content = result.get("choices", [{}])[0].get("message", {}).get("content", "")
            
            # Clean up the response (remove markdown code blocks if present)
            content = content.strip()
            if content.startswith("```"):
                # Remove ```json and ``` markers
                lines = content.split("\n")
                content = "\n".join(lines[1:-1] if lines[-1] == "```" else lines[1:])
            
            # Parse the JSON
            template = json.loads(content)
            
            # Validate structure
            if "parts" in template and isinstance(template["parts"], list):
                # Ensure scale exists
                if "scale" not in template:
                    template["scale"] = 1.0
                
                # Cache the result
                _ai_template_cache[cache_key] = template
                
                print(f"[AI Template] ✅ Generated template for '{object_name}' with {len(template['parts'])} parts")
                return template
            else:
                print(f"[AI Template] ❌ Invalid template structure: {content[:200]}")
                return None
        else:
            print(f"[AI Template] ❌ API error {response.status_code}: {response.text[:200]}")
            return None
            
    except json.JSONDecodeError as e:
        print(f"[AI Template] ❌ JSON parse error: {e}")
        return None
    except Exception as e:
        print(f"[AI Template] ❌ Error: {e}")
        return None


async def generate_3d_model_stability(object_name: str, description: Optional[str] = None) -> Optional[bytes]:
    """
    Generate 3D model using Stability AI Stable Fast 3D API.
    Requires: STABILITY_AI_API_KEY environment variable
    
    Note: This is a placeholder - Stability AI may not have public API yet.
    Check: https://platform.stability.ai/docs
    """
    if not STABILITY_AI_API_KEY:
        return None
    
    prompt = description or f"a 3D model of {object_name}"
    
    # Placeholder - check Stability AI docs for actual endpoint
    # This would typically be:
    # POST https://api.stability.ai/v1/3d/generate
    # Headers: Authorization: Bearer {STABILITY_AI_API_KEY}
    # Body: {"prompt": prompt, "format": "glb"}
    
    print(f"[3D Generator] Stability AI not yet implemented - check their API docs")
    return None


async def generate_3d_model_luma(object_name: str, description: Optional[str] = None) -> Optional[bytes]:
    """
    Generate 3D model using Luma AI Genie API.
    Requires: LUMA_AI_API_KEY environment variable
    
    API Docs: https://docs.luma.ai/
    """
    if not LUMA_AI_API_KEY:
        return None
    
    prompt = description or f"a 3D model of {object_name}"
    
    try:
        # Luma AI Genie API endpoint (check their docs for exact endpoint)
        url = "https://api.luma.ai/v1/generations"
        headers = {
            "Authorization": f"Bearer {LUMA_AI_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "prompt": prompt,
            "aspect_ratio": "1:1",
            "output_format": "glb"
        }
        
        response = requests.post(url, headers=headers, json=payload, timeout=60)
        
        if response.status_code == 200:
            # Luma returns a URL to the generated model
            result = response.json()
            model_url = result.get("url") or result.get("model_url")
            
            if model_url:
                # Download the model
                model_response = requests.get(model_url, timeout=60)
                if model_response.status_code == 200:
                    return model_response.content
        
        print(f"[3D Generator] Luma AI error: {response.status_code} - {response.text}")
        return None
        
    except Exception as e:
        print(f"[3D Generator] Luma AI error: {e}")
        return None


async def generate_3d_model_openai_shap_e(object_name: str, description: Optional[str] = None) -> Optional[bytes]:
    """
    Generate 3D model using OpenAI Shap-E (via API if available, or local).
    Requires: OPENAI_API_KEY environment variable
    
    Note: Shap-E is open source but may need local GPU setup.
    For cloud API, check if OpenAI offers Shap-E endpoint.
    """
    if not OPENAI_API_KEY:
        return None
    
    prompt = description or f"a 3D model of {object_name}"
    
    # Check if OpenAI has Shap-E API endpoint
    # If not, this would require local Shap-E installation with GPU
    # For now, return None - user can set up local Shap-E if needed
    
    print(f"[3D Generator] OpenAI Shap-E requires local setup or API endpoint")
    return None


async def generate_3d_model_replicate(object_name: str, description: Optional[str] = None) -> Optional[bytes]:
    """
    Generate 3D model using Replicate API (hosts various 3D models).
    Requires: REPLICATE_API_TOKEN environment variable
    
    Replicate hosts Shap-E and other 3D models as APIs.
    API Docs: https://replicate.com/docs
    """
    replicate_token = os.getenv("REPLICATE_API_TOKEN")
    if not replicate_token:
        return None
    
    prompt = description or f"a 3D model of {object_name}"
    
    try:
        # Replicate Shap-E model
        url = "https://api.replicate.com/v1/predictions"
        headers = {
            "Authorization": f"Token {replicate_token}",
            "Content-Type": "application/json"
        }
        # Use a more specific prompt with color/material hints for better results
        enhanced_prompt = f"{prompt}, vibrant colors, detailed textures, realistic materials"
        
        payload = {
            "version": "shap-e",  # Check Replicate for exact model version
            "input": {
                "prompt": enhanced_prompt,
                "output_format": "glb",
                "guidance_scale": 15.0,  # Higher guidance = more adherence to prompt (better colors)
                "num_inference_steps": 64  # More steps = better quality
            }
        }
        
        # Create prediction
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        
        if response.status_code == 201:
            prediction = response.json()
            prediction_id = prediction.get("id")
            
            # Poll for completion
            status_url = f"https://api.replicate.com/v1/predictions/{prediction_id}"
            max_attempts = 60
            
            for attempt in range(max_attempts):
                await asyncio.sleep(2)  # Wait 2 seconds between polls
                
                status_response = requests.get(status_url, headers=headers, timeout=30)
                if status_response.status_code == 200:
                    status_data = status_response.json()
                    status = status_data.get("status")
                    
                    if status == "succeeded":
                        output_url = status_data.get("output")
                        if output_url:
                            # Download the model
                            model_response = requests.get(output_url, timeout=60)
                            if model_response.status_code == 200:
                                return model_response.content
                    elif status == "failed":
                        print(f"[3D Generator] Replicate generation failed: {status_data.get('error')}")
                        return None
            
            print(f"[3D Generator] Replicate timeout after {max_attempts * 2} seconds")
            return None
        else:
            print(f"[3D Generator] Replicate error: {response.status_code} - {response.text}")
            return None
            
    except Exception as e:
        print(f"[3D Generator] Replicate error: {e}")
        return None


async def generate_3d_model(object_name: str, description: Optional[str] = None) -> Optional[bytes]:
    """
    Main function to generate 3D model.
    Tries multiple APIs in order of preference.
    
    Priority:
    1. Replicate (easiest, hosts Shap-E)
    2. Luma AI (commercial, good quality)
    3. Stability AI (if available)
    4. OpenAI Shap-E (requires local setup)
    
    Returns:
        bytes: Model file data (GLB format) or None if all fail
    """
    generators = [
        ("Replicate", generate_3d_model_replicate),
        ("Luma AI", generate_3d_model_luma),
        ("Stability AI", generate_3d_model_stability),
        ("OpenAI Shap-E", generate_3d_model_openai_shap_e),
    ]
    
    for name, generator_func in generators:
        try:
            print(f"[3D Generator] Trying {name}...")
            result = await generator_func(object_name, description)
            if result:
                print(f"[3D Generator] ✓ Successfully generated using {name}")
                return result
        except Exception as e:
            print(f"[3D Generator] {name} failed: {e}")
            continue
    
    print(f"[3D Generator] ✗ All generators failed - falling back to basic shapes")
    return None

