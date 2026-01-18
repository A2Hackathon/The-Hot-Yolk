"""
3D Model Generation Integrations
Supports multiple 3D generation APIs with fallback options.
"""
import os
import requests
import asyncio
from typing import Optional, Dict, List
import json
import time

# API Configuration
TRIPOSR_API_KEY = os.getenv("TRIPOSR_API_KEY") or os.getenv("AIMLAPI_KEY") or os.getenv("AIML_API_KEY")  # TripoSR via AIMLAPI
TRIPO3D_API_KEY = os.getenv("TRIPO3D_API_KEY")  # Legacy - kept for backward compatibility
STABILITY_AI_API_KEY = os.getenv("STABILITY_AI_API_KEY")
LUMA_AI_API_KEY = os.getenv("LUMA_AI_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# Cache for AI-generated templates (persist across requests)
_ai_template_cache: Dict[str, Dict] = {}

# Cache for TripoSR model URLs (persist across requests)
_triposr_model_cache: Dict[str, str] = {}


async def generate_3d_model_triposr(image_data: Optional[str] = None, image_url: Optional[str] = None, object_name: Optional[str] = None, prompt: Optional[str] = None) -> Optional[str]:
    """
    Generate 3D model using TripoSR API via AIMLAPI.
    Supports BOTH text-to-3D (using prompt) and image-to-3D (using image_url).
    TripoSR is fast (under 0.5 seconds) and generates 3D meshes.
    Returns GLB model URL if successful, None otherwise.
    
    API Docs: https://docs.aimlapi.com/api-references/3d-generating-models/stability-ai/triposr
    Requires: AIML_API_KEY, TRIPOSR_API_KEY, or AIMLAPI_KEY environment variable
    
    Args:
        image_data: Optional base64 encoded image data (for ImgBB fallback if using image-to-3D)
        image_url: Optional direct image URL (for image-to-3D mode)
        object_name: Optional name for caching purposes
        prompt: Optional text description (for text-to-3D mode - NO IMAGE URL NEEDED!)
    
    Returns:
        str: Direct URL to GLB model file, or None if generation failed
    
    Note: If prompt is provided, uses text-to-3D (no image needed). If image_url is provided, uses image-to-3D.
          Can use both together for better results.
    """
    global _triposr_model_cache
    
    if not TRIPOSR_API_KEY:
        print(f"[TripoSR] ❌ TRIPOSR_API_KEY, AIMLAPI_KEY, or AIML_API_KEY not set in environment")
        return None
    
    # Check cache first (if object_name provided)
    if object_name:
        cache_key = object_name.lower().replace(" ", "_").replace("-", "_")
        if cache_key in _triposr_model_cache:
            print(f"[TripoSR] ✅ Using cached model URL for '{object_name}'")
            return _triposr_model_cache[cache_key]
    
    try:
        # AIMLAPI TripoSR endpoint
        api_url = "https://api.aimlapi.com/v1/images/generations"
        headers = {
            "Authorization": f"Bearer {TRIPOSR_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # NEW: Check if we should use text-to-3D mode (prompt) or image-to-3D mode (image_url)
        if prompt:
            # TEXT-TO-3D MODE: Use prompt (no image URL needed! Solves localhost issue!)
            print(f"[TripoSR] 🚀 Generating 3D model from TEXT DESCRIPTION (TripoSR text-to-3D)...")
            print(f"[TripoSR] Using AIML_API_KEY: {TRIPOSR_API_KEY[:10] if TRIPOSR_API_KEY else 'NOT SET'}...")
            print(f"[TripoSR] Prompt: {prompt[:150]}...")
            print(f"[TripoSR] 💡 Using text-to-3D mode - NO IMAGE URL NEEDED (solves localhost issue!)")
            
            payload = {
                "model": "triposr",
                "prompt": prompt,
                "output_format": "glb",
                "mc_resolution": 256  # Good balance of detail vs speed
            }
            
            # Optionally include image_url if provided (can improve results)
            if image_url and ("localhost" not in image_url and "127.0.0.1" not in image_url):
                payload["image_url"] = image_url
                print(f"[TripoSR] 📸 Also using image URL as reference: {image_url[:60]}...")
        else:
            # IMAGE-TO-3D MODE: Use image_url (original behavior)
            print(f"[TripoSR] 🚀 Generating 3D model from IMAGE (TripoSR image-to-3D)...")
            print(f"[TripoSR] Using AIML_API_KEY: {TRIPOSR_API_KEY[:10] if TRIPOSR_API_KEY else 'NOT SET'}...")
            
            if not image_data and not image_url:
                print(f"[TripoSR] ❌ No image data or image URL provided for image-to-3D mode")
                return None
            
            # Prepare image data - convert base64 data URL to base64 string
            image_base64 = None
            if image_data:
                image_base64 = image_data
                if ',' in image_data:
                    image_base64 = image_data.split(',')[1]
                print(f"[TripoSR] Image size: {len(image_base64)} chars (base64)")
            
            print(f"[TripoSR] Image URL provided: {image_url[:80] if image_url else 'None'}...")
            
            # Step 1: Use provided image_url if available (backend-hosted, preferred)
            if image_url:
                # Check if image_url is localhost - AIMLAPI can't access localhost!
                if "localhost" in image_url or "127.0.0.1" in image_url:
                    print(f"[TripoSR] ⚠️ WARNING: Image URL is localhost ({image_url[:80]}...)")
                    print(f"[TripoSR] ⚠️ AIMLAPI cannot access localhost URLs from their servers!")
                    print(f"[TripoSR] 💡 Falling back to ImgBB upload (or use publicly accessible URL)")
                    image_url = None  # Force ImgBB upload
                else:
                    print(f"[TripoSR] ✅ Using provided image URL: {image_url[:80]}...")
            
            if not image_url:
                # Step 2: If no image_url or localhost, try ImgBB (if API key provided)
                imgbb_api_key = os.getenv("IMGBB_API_KEY")
                
                if imgbb_api_key and imgbb_api_key != "free" and image_base64:
                    # Try ImgBB (public hosting, works with AIMLAPI)
                    try:
                        print(f"[TripoSR] 📤 Uploading to ImgBB (public hosting for AIMLAPI)...")
                        imgbb_url = "https://api.imgbb.com/1/upload"
                        imgbb_response = requests.post(
                            imgbb_url,
                            data={
                                "key": imgbb_api_key,
                                "image": image_base64
                            },
                            timeout=30
                        )
                        
                        if imgbb_response.status_code == 200:
                            imgbb_data = imgbb_response.json()
                            image_url = imgbb_data.get("data", {}).get("url")
                            if image_url:
                                print(f"[TripoSR] ✅ Image uploaded to ImgBB: {image_url[:60]}...")
                        else:
                            print(f"[TripoSR] ⚠️ ImgBB upload failed: {imgbb_response.status_code}")
                            print(f"[TripoSR] 💡 Error: {imgbb_response.text[:200]}")
                    except Exception as imgbb_error:
                        print(f"[TripoSR] ⚠️ ImgBB upload failed: {imgbb_error}")
                
                # If still no image_url, we can't proceed with image-to-3D
                if not image_url:
                    print(f"[TripoSR] ❌ No publicly accessible image URL available")
                    print(f"[TripoSR] 💡 Problem: Backend URL is localhost (AIMLAPI can't access it)")
                    print(f"[TripoSR] 💡 Solution:")
                    print(f"[TripoSR]    1. Get free ImgBB API key from https://api.imgbb.com/")
                    print(f"[TripoSR]    2. Add to backend/.env: IMGBB_API_KEY=your_key_here")
                    print(f"[TripoSR]    3. Or use text-to-3D mode with prompt instead!")
                    print(f"[TripoSR] 💡 ImgBB free tier requires API key but is easy to get")
                    return None
            
            # Step 2: Send to AIMLAPI TripoSR with image URL
            payload = {
                "model": "triposr",
                "image_url": image_url,
                "output_format": "glb",
                "do_remove_background": False,  # Keep background for full scene
                "mc_resolution": 256  # Good balance of detail vs speed
            }
        
        if prompt:
            print(f"[TripoSR] 📤 Sending to AIMLAPI TripoSR (text-to-3D mode, ~0.5 seconds)...")
            print(f"[TripoSR] Endpoint: {api_url}")
            print(f"[TripoSR] Payload: model=triposr, prompt={prompt[:80]}..., output_format=glb")
        else:
            print(f"[TripoSR] 📤 Sending to AIMLAPI TripoSR (image-to-3D mode, ~0.5 seconds)...")
            print(f"[TripoSR] Endpoint: {api_url}")
            print(f"[TripoSR] Payload: model=triposr, image_url={image_url[:80]}..., output_format=glb")
        
        response = requests.post(api_url, headers=headers, json=payload, timeout=60)
        
        print(f"[TripoSR] Response status: {response.status_code}")
        
        if response.status_code != 200:
            error_detail = response.text[:1000] if response.text else "No error message"
            print(f"[TripoSR] ❌ AIMLAPI request failed: {response.status_code}")
            print(f"[TripoSR] 💡 Error details: {error_detail}")
            print(f"[TripoSR] 💡 Full response headers: {dict(response.headers)}")
            
            # Check for common errors
            if response.status_code == 401:
                print(f"[TripoSR] 💡 401 Unauthorized - Check if AIML_API_KEY is valid")
                print(f"[TripoSR] 💡 Your key starts with: {TRIPOSR_API_KEY[:10] if TRIPOSR_API_KEY else 'NOT SET'}...")
            elif response.status_code == 402:
                print(f"[TripoSR] 💡 402 Payment Required - Check if you have credits in AIMLAPI account")
                print(f"[TripoSR] 💡 Go to https://aimlapi.com/ to add credits")
            elif response.status_code == 403:
                print(f"[TripoSR] 💡 403 Forbidden - API key may not have TripoSR access")
            elif response.status_code == 404:
                print(f"[TripoSR] 💡 404 Not Found - Check if image URL is accessible")
                print(f"[TripoSR] 💡 Image URL: {image_url}")
                print(f"[TripoSR] 💡 Try accessing the URL in browser to verify it works")
            elif response.status_code == 429:
                print(f"[TripoSR] 💡 429 Rate Limited - Wait a minute and try again")
            elif response.status_code >= 500:
                print(f"[TripoSR] 💡 {response.status_code} Server Error - AIMLAPI may be down, try again later")
            
            return None
        
        result = response.json()
        
        # Extract model URL from AIMLAPI response
        # AIMLAPI returns: {"model_mesh": {"url": "...", "file_name": "...", ...}}
        model_mesh = result.get("model_mesh") or result.get("data", {}).get("model_mesh") or {}
        model_url = model_mesh.get("url") or model_mesh.get("model_url") or result.get("url")
        
        if model_url:
            print(f"[TripoSR] ✅ Model generated successfully! (~0.5 seconds - very fast!)")
            print(f"[TripoSR] 📦 Model URL: {model_url}")
            
            # Cache the URL if object_name provided
            if object_name:
                cache_key = object_name.lower().replace(" ", "_").replace("-", "_")
                _triposr_model_cache[cache_key] = model_url
            
            return model_url
        else:
            print(f"[TripoSR] ❌ No model URL in response: {result}")
            print(f"[TripoSR] 💡 Available fields: {list(result.keys())}")
            if "model_mesh" in result:
                print(f"[TripoSR] 💡 model_mesh fields: {list(result['model_mesh'].keys())}")
            return None
        
    except requests.exceptions.Timeout:
        print(f"[TripoSR] ⏰ Request timed out")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[TripoSR] ❌ Network error: {e}")
        return None
    except Exception as e:
        print(f"[TripoSR] ❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return None


async def generate_3d_model_tripo3d(object_name: str, description: Optional[str] = None) -> Optional[str]:
    """
    Generate 3D model using Tripo3D API (text-to-3D).
    Returns GLB model URL if successful, None otherwise.
    
    API Docs: https://platform.tripo3d.ai/docs
    Requires: TRIPO3D_API_KEY environment variable
    
    Args:
        object_name: Name of the object to generate (e.g., "coffee maker", "chair")
        description: Optional detailed description for better results
    
    Returns:
        str: Direct URL to GLB model file, or None if generation failed
    """
    global _tripo3d_model_cache
    
    if not TRIPO3D_API_KEY:
        print(f"[Tripo3D] ❌ TRIPO3D_API_KEY not set in environment")
        return None
    
    # Check cache first
    cache_key = object_name.lower().replace(" ", "_").replace("-", "_")
    if cache_key in _tripo3d_model_cache:
        print(f"[Tripo3D] ✅ Using cached model URL for '{object_name}'")
        return _tripo3d_model_cache[cache_key]
    
    try:
        # Prepare prompt
        prompt = description or f"a realistic 3D model of a {object_name}, detailed, game-ready asset"
        
        print(f"[Tripo3D] 🚀 Generating 3D model for '{object_name}'...")
        print(f"[Tripo3D] Prompt: {prompt}")
        
        # Tripo3D API endpoint (text-to-3D)
        api_url = "https://api.tripo3d.ai/v2/openapi/task"
        headers = {
            "Authorization": f"Bearer {TRIPO3D_API_KEY}",
            "Content-Type": "application/json"
        }
        
        # Create generation task
        payload = {
            "type": "text_to_model",
            "prompt": prompt,
            "model_version": "v2.0-20240919",  # Latest stable version
            "face_limit": 10000,  # Polygon count (10k for game assets)
            "texture": True,  # Include textures
            "pbr": True  # PBR materials for realistic rendering
        }
        
        response = requests.post(api_url, headers=headers, json=payload, timeout=30)
        
        if response.status_code != 200:
            print(f"[Tripo3D] ❌ Task creation failed: {response.status_code} - {response.text}")
            return None
        
        result = response.json()
        task_id = result.get("data", {}).get("task_id")
        
        if not task_id:
            print(f"[Tripo3D] ❌ No task_id in response: {result}")
            return None
        
        print(f"[Tripo3D] 📋 Task created: {task_id}")
        print(f"[Tripo3D] ⏳ Waiting for generation (may take 30-60 seconds)...")
        
        # Poll for completion
        status_url = f"https://api.tripo3d.ai/v2/openapi/task/{task_id}"
        max_attempts = 60  # 60 attempts * 2 seconds = 2 minutes max
        
        for attempt in range(max_attempts):
            await asyncio.sleep(2)  # Wait 2 seconds between polls
            
            status_response = requests.get(status_url, headers=headers, timeout=30)
            
            if status_response.status_code != 200:
                print(f"[Tripo3D] ⚠️ Status check failed: {status_response.status_code}")
                continue
            
            status_data = status_response.json()
            task_status = status_data.get("data", {}).get("status")
            
            if task_status == "success":
                # Extract model URL
                output = status_data.get("data", {}).get("output", {})
                # Tripo3D API returns 'pbr_model' (not 'model') for PBR models
                model_url = output.get("pbr_model") or output.get("model")  # Try both fields
                
                if model_url:
                    print(f"[Tripo3D] ✅ Model generated successfully!")
                    print(f"[Tripo3D] 📦 Model URL: {model_url}")
                    
                    # Cache the URL
                    _tripo3d_model_cache[cache_key] = model_url
                    
                    return model_url
                else:
                    print(f"[Tripo3D] ❌ No model URL in response: {output}")
                    print(f"[Tripo3D] 💡 Available fields: {list(output.keys())}")
                    return None
            
            elif task_status == "failed":
                error_msg = status_data.get("data", {}).get("error", "Unknown error")
                print(f"[Tripo3D] ❌ Generation failed: {error_msg}")
                return None
            
            elif task_status == "running" or task_status == "queued":
                if attempt % 5 == 0:  # Log every 10 seconds
                    print(f"[Tripo3D] ⏳ Still generating... ({attempt * 2}s elapsed)")
            
            else:
                print(f"[Tripo3D] ⚠️ Unknown status: {task_status}")
        
        print(f"[Tripo3D] ⏰ Timeout after {max_attempts * 2} seconds")
        return None
        
    except requests.exceptions.Timeout:
        print(f"[Tripo3D] ⏰ Request timed out")
        return None
    except requests.exceptions.RequestException as e:
        print(f"[Tripo3D] ❌ Network error: {e}")
        return None
    except Exception as e:
        print(f"[Tripo3D] ❌ Unexpected error: {e}")
        import traceback
        traceback.print_exc()
        return None


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

