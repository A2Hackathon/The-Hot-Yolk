"""
3D Model Generation API
Handles generation and retrieval of detailed 3D models for creative objects.
"""
from fastapi import APIRouter, HTTPException, BackgroundTasks
from typing import Dict, Optional
from pydantic import BaseModel
import os
import json
from models.cache import get_cached_model, save_model_to_cache, get_cache_key

router = APIRouter()

class ModelGenerationRequest(BaseModel):
    object_name: str
    description: Optional[str] = None
    force_regenerate: bool = False

class ModelGenerationResponse(BaseModel):
    cache_key: str
    model_url: str
    cached: bool
    status: str  # "cached", "generating", "ready"

# Import 3D model generators
import sys
from pathlib import Path
backend_dir = Path(__file__).parent.parent.parent
sys.path.insert(0, str(backend_dir))

from models.generators import generate_3d_model

@router.post("/generate-model")
async def generate_model(
    request: ModelGenerationRequest,
    background_tasks: BackgroundTasks
) -> ModelGenerationResponse:
    """
    Generate or retrieve a detailed 3D model for a creative object.
    
    Flow:
    1. Check cache first
    2. If cached, return immediately
    3. If not cached and not force_regenerate, start background generation
    4. Return status indicating cached or generating
    """
    # Check cache first
    if not request.force_regenerate:
        cached = get_cached_model(request.object_name, request.description)
        if cached:
            return ModelGenerationResponse(
                cache_key=cached["cache_key"],
                model_url=f"/assets/models_cache/{cached['cache_key']}.glb",
                cached=True,
                status="cached"
            )
    
    # Model not in cache - start generation
    cache_key = get_cache_key(request.object_name, request.description)
    
    # Start background generation
    background_tasks.add_task(
        generate_and_cache_model,
        request.object_name,
        request.description,
        cache_key
    )
    
    return ModelGenerationResponse(
        cache_key=cache_key,
        model_url=f"/assets/models_cache/{cache_key}.glb",
        cached=False,
        status="generating"
    )


async def generate_and_cache_model(object_name: str, description: Optional[str], cache_key: str):
    """
    Background task to generate and cache a 3D model.
    """
    try:
        print(f"[Model Generation] Starting generation for: {object_name}")
        
        # Generate model using available APIs
        model_data = await generate_3d_model(object_name, description)
        
        if model_data:
            # Save to cache
            save_model_to_cache(
                object_name=object_name,
                model_data=model_data,
                model_format="glb",
                description=description,
                metadata={
                    "generated_at": str(Path(__file__).stat().st_mtime),  # Simple timestamp
                    "size_mb": len(model_data) / (1024 * 1024)
                }
            )
            print(f"[Model Generation] ✓ Successfully generated and cached: {object_name}")
        else:
            print(f"[Model Generation] ✗ Failed to generate model for: {object_name}")
            
    except Exception as e:
        print(f"[Model Generation] Error: {e}")
        import traceback
        traceback.print_exc()

@router.get("/model-status/{cache_key}")
async def get_model_status(cache_key: str) -> Dict:
    """Check the status of a model generation."""
    cached = None
    # Try to find by cache key
    cache_files = os.listdir("assets/models_cache")
    for file in cache_files:
        if file.startswith(cache_key) and file.endswith("_meta.json"):
            with open(f"assets/models_cache/{file}", 'r') as f:
                cached = json.load(f)
            break
    
    if cached:
        return {
            "status": "ready",
            "model_url": f"/assets/models_cache/{cache_key}.glb",
            "cached": True,
            "metadata": cached
        }
    else:
        return {
            "status": "generating",
            "cached": False
        }

@router.get("/list-cached-models")
async def list_cached_models() -> Dict:
    """List all cached models."""
    from models.cache import list_cached_models
    return {"models": list_cached_models()}

