from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Optional
import base64
import json
from world.overshoot_integration import (
    analyze_with_openai_vision,  # For single image/frame analysis
    analyze_video_with_overshoot,  # For video analysis
    generate_world_from_scan
)

router = APIRouter()

class ScanRequest(BaseModel):
    image_data: str  # Base64 encoded image (frame)

class VideoRequest(BaseModel):
    video_data: str  # Base64 encoded video

@router.post("/scan-world")
async def scan_world(request: ScanRequest) -> Dict:
    """
    Analyze an IMAGE/FRAME using OpenAI Vision API.
    Frontend sends frames, backend sends to OpenAI.
    """
    try:
        print(f"[OPENAI] Received frame data length: {len(request.image_data)}")
        
        # Validate image data
        if not request.image_data or len(request.image_data) < 100:
            raise HTTPException(status_code=400, detail="Invalid image data provided")
        
        # Use OpenAI Vision for frame analysis
        print("[OPENAI] Analyzing frame with OpenAI Vision...")
        scan_result = await analyze_with_openai_vision(request.image_data)
        
        if not scan_result:
            raise HTTPException(
                status_code=500, 
                detail="Failed to analyze frame. Please ensure OPENAI_API_KEY is set in backend/.env file."
            )
        
        print(f"[OPENAI] Vision analysis result: {scan_result}")
        
        # Generate world parameters from scan data
        print("[OPENAI] Generating world from analysis...")
        world_data = generate_world_from_scan(scan_result)
        
        if not world_data:
            raise HTTPException(
                status_code=500, 
                detail="Failed to generate world from analysis"
            )
        
        print(f"[OPENAI] World generated: {world_data.get('world', {}).get('biome', 'unknown')}")
        
        return world_data
        
    except HTTPException:
        raise
    except Exception as e:
        print(f"[OPENAI] Error: {str(e)}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Frame analysis failed: {str(e)}")


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