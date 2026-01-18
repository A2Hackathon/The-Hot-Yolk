from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Dict, Optional
import base64
import json
import os
import tempfile
import time
from pathlib import Path
from world.overshoot_integration import (
    analyze_with_openai_vision,  # For single image/frame analysis (OTHER FEATURES)
    scan_entire_scene_with_vision,  # For camera scanning ONLY (SCAN FEATURE)
    analyze_video_with_overshoot,  # For video analysis
    generate_world_from_scan
)

router = APIRouter()

# Temporary image storage (in-memory, cleared on restart)
_temp_images: Dict[str, tuple] = {}  # {image_id: (image_data, timestamp)}

class ScanRequest(BaseModel):
    image_data: str

class VideoRequest(BaseModel):
    video_data: str  # Base64 encoded video

@router.get("/temp-image/{image_id}")
async def get_temp_image(image_id: str):
    """
    Temporary endpoint to serve images for TripoSR.
    Images are stored in-memory and expire after 5 minutes.
    """
    if image_id not in _temp_images:
        raise HTTPException(status_code=404, detail="Image not found or expired")
    
    image_data, timestamp = _temp_images[image_id]
    
    # Check if expired (5 minutes)
    if time.time() - timestamp > 300:
        del _temp_images[image_id]
        raise HTTPException(status_code=404, detail="Image expired")
    
    # Decode base64
    if ',' in image_data:
        image_data = image_data.split(',')[1]
    
    image_bytes = base64.b64decode(image_data)
    
    # Detect content type from base64 prefix
    content_type = "image/jpeg"
    if image_data.startswith("iVBORw0KGgo"):  # PNG
        content_type = "image/png"
    elif image_data.startswith("/9j/"):  # JPEG
        content_type = "image/jpeg"
    
    return Response(content=image_bytes, media_type=content_type)


@router.post("/scan-world")
async def scan_world(request: ScanRequest) -> Dict:
    """
    NEW: Analyze ENTIRE scene and generate complete 3D world from it.
    Uses OpenAI Vision to describe scene → TripoSR (image-to-3D) to generate full 3D model.
    TripoSR uses the OpenAI description as a prompt to guide 3D reconstruction from the image.
    """
    print(f"\n{'='*60}", flush=True)
    print(f"[SCAN] =============================================================", flush=True)
    print(f"[SCAN] /scan-world ENDPOINT CALLED!", flush=True)
    print(f"[SCAN] =============================================================\n", flush=True)
    
    try:
        print(f"[SCAN] Received request!", flush=True)
        print(f"[SCAN] Image data length: {len(request.image_data)}", flush=True)
        
        # Validate image data
        if not request.image_data or len(request.image_data) < 100:
            raise HTTPException(status_code=400, detail="Invalid image data provided")
        
        # Step 1: Use scan-specific vision function to describe the ENTIRE scene
        # NEW: Now uses BOTH Overshoot AND OpenRouter Vision for richer descriptions!
        print("[SCAN] Analyzing entire scene for 3D generation...", flush=True)
        print("[SCAN] Using BOTH Overshoot AI and OpenRouter Vision for richer descriptions!", flush=True)
        scan_result = await scan_entire_scene_with_vision(request.image_data, use_overshoot=True)
        
        if not scan_result:
            raise HTTPException(
                status_code=500, 
                detail="Failed to analyze scene. Please ensure OPENAI_API_KEY is set in backend/.env file."
            )
        
        scene_description = scan_result.get("scene_description", "")
        if not scene_description:
            print(f"[SCAN] WARNING: No scene_description in scan_result!", flush=True)
            print(f"[SCAN] scan_result keys: {list(scan_result.keys())}", flush=True)
            print(f"[SCAN] scan_result: {str(scan_result)[:500]}", flush=True)
            # Try to build description from other fields
            scene_description = f"A {scan_result.get('scene_type', 'indoor')} scene with {len(scan_result.get('primary_elements', []))} primary elements."
        
        print(f"[SCAN] Scene analyzed: {scene_description[:150]}...", flush=True)
        print(f"[SCAN] Full description length: {len(scene_description)} characters", flush=True)
        
        # Step 2: Use TripoSR for text-to-3D generation using ONLY the description (no image_url needed)
        print("[SCAN] Generating 3D world using TripoSR with description-only (text-to-3D)...", flush=True)
        print(f"[SCAN] Scene description (used as prompt): {scene_description[:150]}...", flush=True)
        print(f"[SCAN] Description length: {len(scene_description)} characters", flush=True)
        print("[SCAN] Using TripoSR (AIMLAPI) for text-to-3D reconstruction from OpenAI description", flush=True)
        
        from models.generators import generate_3d_model_triposr
        
        # Use TripoSR with ONLY the description (prompt) - no image_url needed
        model_url = await generate_3d_model_triposr(
            object_name="scanned_environment",
            prompt=scene_description  # OpenAI description - TripoSR reconstructs 3D from this text only
        )
        
        print(f"[SCAN] TripoSR returned: {model_url if model_url else 'None (generation failed)'}", flush=True)
        
        if not model_url:
            # Check if API key is set
            api_key = os.getenv("TRIPOSR_API_KEY") or os.getenv("AIMLAPI_KEY") or os.getenv("AIML_API_KEY")
            api_key_status = "SET" if api_key else "NOT SET"
            api_key_preview = f"{api_key[:10]}..." if api_key else "N/A"
            
            # Determine error message
            error_msg = f"TripoSR text-to-3D generation failed - check backend logs above for detailed error."
            
            print(f"[SCAN] {error_msg}", flush=True)
            print(f"[SCAN] Diagnosis:", flush=True)
            print(f"[SCAN]    - API Key Status: {api_key_status}", flush=True)
            print(f"[SCAN]    - API Key Preview: {api_key_preview}", flush=True)
            print(f"[SCAN]    - Scene Description Length: {len(scene_description)} characters", flush=True)
            print(f"[SCAN]    - Scene Description Preview: {scene_description[:200]}...", flush=True)
            print(f"[SCAN] Look at TripoSR error messages ABOVE to see exact failure reason", flush=True)
            print(f"[SCAN] Common issues:", flush=True)
            print(f"[SCAN]    1. AIML_API_KEY/TRIPOSR_API_KEY not set (check backend/.env file)", flush=True)
            print(f"[SCAN]    2. No credits in AIMLAPI account", flush=True)
            print(f"[SCAN]    3. API endpoint changed or network error", flush=True)
            print(f"[SCAN]    4. Generation timeout", flush=True)
            print(f"[SCAN] Note: TripoSR uses description-only (prompt) for text-to-3D reconstruction", flush=True)
            
            # Fallback: return scan data without 3D model (new format)
            return {
                "world": {
                    "type": "scan_fallback",
                    "scene_description": scene_description,
                    "scene_type": scan_result.get("scene_type", "indoor"),
                    "colors": scan_result.get("colors", {}).get("palette", []),
                    "error": error_msg
                },
                "model_url": None,
                "scan_data": scan_result,
                "error": error_msg,
                # Keep old format for backward compatibility with frontend
                "biome": scan_result.get("scene_type", "indoor")
            }
        
        print(f"[SCAN] Complete 3D world generated: {model_url}", flush=True)
        
        # Step 3: Return world data with single GLB model
        return {
            "world": {
                "type": "scanned_environment",
                "scene_description": scene_description,
                "scene_type": scan_result.get("scene_type", "indoor"),
                "model_url": model_url,  # Single GLB for entire scene
                "colors": scan_result.get("colors", {}).get("palette", []),
                "lighting": scan_result.get("lighting", {}),
                "scale_reference": scan_result.get("scale_reference", "")
            },
            "structures": {
                "scene_model": {
                    "type": "glb_model",
                    "model_url": model_url,
                    "position": {"x": 0, "y": 0, "z": 0},  # Center of world
                    "scale": 1.0,
                    "rotation": 0
                }
            },
            "spawn_point": {"x": 0, "y": 1, "z": 10},  # Spawn in front of scene
            "scan_data": scan_result
        }
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[SCAN] CRITICAL ERROR in scan_world endpoint: {str(e)}", flush=True)
        print(f"[SCAN] Error type: {type(e).__name__}", flush=True)
        import traceback
        print(f"[SCAN] Full traceback:", flush=True)
        traceback.print_exc()
        
        # Return fallback response in NEW format (with world key)
        print(f"[SCAN] Returning fallback response (new format with world key)", flush=True)
        return {
            "world": {
                "type": "scan_fallback",
                "scene_description": "",
                "scene_type": "indoor",
                "colors": {"palette": []},
                "error": f"Scan failed: {str(e)}"
            },
            "model_url": None,
            "error": f"Scene scan failed: {str(e)}",
            # Include biome for backward compatibility
            "biome": "room"
        }


@router.post("/stream-video")
async def stream_video(request: VideoRequest) -> Dict:
    """
    Analyze VIDEO using Overshoot AI.
    Frontend sends recorded video, backend sends to Overshoot.
    """
    try:
        print(f"[OVERSHOOT] Received video data length: {len(request.video_data)}")
        
        # Validate video data
        if not request.video_data or len(request.video_data) < 1000:
            raise HTTPException(status_code=400, detail="Invalid video data provided")
        
        # Use Overshoot AI for video analysis
        print("[OVERSHOOT] Analyzing video with Overshoot AI...")
        scan_result = await analyze_video_with_overshoot(request.video_data)
        
        if not scan_result:
            raise HTTPException(
                status_code=500, 
                detail="Failed to analyze video. Please ensure OVERSHOOT_API_KEY is set in backend/.env file."
            )
        
        print(f"[OVERSHOOT] Video analysis result: {scan_result}")
        
        # Generate world parameters from scan data
        print("[OVERSHOOT] Generating world from video analysis...")
        world_data = generate_world_from_scan(scan_result)
        
        if not world_data:
            raise HTTPException(
                status_code=500, 
                detail="Failed to generate world from video analysis"
            )
        
        print(f"[OVERSHOOT] World generated: {world_data.get('world', {}).get('biome', 'unknown')}")
        
        return world_data
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[OVERSHOOT] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Video analysis failed: {str(e)}")
