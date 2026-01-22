from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
import base64
import json
from world.overshoot_integration import analyze_with_openai_vision, generate_world_from_scan

router = APIRouter()

class ScanRequest(BaseModel):
    image_data: str  # Base64 encoded image

@router.post("/scan-world")
async def scan_world(request: ScanRequest) -> Dict:
    """
    Analyze an image and generate a 3D world based on its content.
    Uses OpenAI Vision API as the primary method.
    """
    try:
        print(f"[SCAN] Received image data length: {len(request.image_data)}")
        
        # Validate image data
        if not request.image_data or len(request.image_data) < 100:
            raise HTTPException(status_code=400, detail="Invalid image data provided")
        
        # Try OpenAI Vision first (recommended for single images)
        print("[SCAN] Attempting OpenAI Vision analysis...")
        scan_result = analyze_with_openai_vision(request.image_data)
        
        if not scan_result:
            raise HTTPException(
                status_code=500, 
                detail="Failed to analyze image. Please ensure OPENAI_API_KEY is set in backend/.env file."
            )
        
        print(f"[SCAN] Vision analysis result: {scan_result}")
        
        # Generate world parameters from scan data
        print("[SCAN] Generating world from scan data...")
        world_data = generate_world_from_scan(scan_result)
        
        if not world_data:
            raise HTTPException(
                status_code=500, 
                detail="Failed to generate world from scan data"
            )
        
        print(f"[SCAN] World generated successfully: {world_data.get('world', {}).get('biome', 'unknown')}")
        
        return world_data
        
    except HTTPException:
        raise  # Re-raise HTTP exceptions
    except Exception as e:
        print(f"[SCAN] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Scan failed: {str(e)}")