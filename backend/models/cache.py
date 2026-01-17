"""
3D Model Cache System
Handles caching of generated 3D models to avoid regenerating the same objects.
"""
import os
import json
import hashlib
from typing import Optional, Dict
from pathlib import Path

CACHE_DIR = Path("assets/models_cache")
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_METADATA_FILE = CACHE_DIR / "cache_metadata.json"

def get_cache_key(object_name: str, description: Optional[str] = None) -> str:
    """Generate a cache key from object name and optional description."""
    key_string = f"{object_name.lower().strip()}"
    if description:
        key_string += f":{description.lower().strip()}"
    return hashlib.md5(key_string.encode()).hexdigest()

def get_cached_model(object_name: str, description: Optional[str] = None) -> Optional[Dict]:
    """
    Check if a model exists in cache.
    Returns model metadata if found, None otherwise.
    """
    cache_key = get_cache_key(object_name, description)
    model_file = CACHE_DIR / f"{cache_key}.glb"
    metadata_file = CACHE_DIR / f"{cache_key}_meta.json"
    
    if model_file.exists() and metadata_file.exists():
        try:
            with open(metadata_file, 'r') as f:
                metadata = json.load(f)
            return {
                "model_path": str(model_file),
                "cache_key": cache_key,
                "metadata": metadata
            }
        except Exception as e:
            print(f"[CACHE] Error reading cached model: {e}")
            return None
    return None

def save_model_to_cache(
    object_name: str,
    model_data: bytes,
    model_format: str = "glb",
    description: Optional[str] = None,
    metadata: Optional[Dict] = None
) -> str:
    """
    Save a generated model to cache.
    Returns the cache key.
    """
    cache_key = get_cache_key(object_name, description)
    model_file = CACHE_DIR / f"{cache_key}.{model_format}"
    metadata_file = CACHE_DIR / f"{cache_key}_meta.json"
    
    # Save model file
    with open(model_file, 'wb') as f:
        f.write(model_data)
    
    # Save metadata
    cache_metadata = {
        "object_name": object_name,
        "description": description,
        "cache_key": cache_key,
        "format": model_format,
        "size_bytes": len(model_data),
        **(metadata or {})
    }
    
    with open(metadata_file, 'w') as f:
        json.dump(cache_metadata, f, indent=2)
    
    # Update global cache metadata
    update_cache_metadata(cache_key, cache_metadata)
    
    print(f"[CACHE] Saved model to cache: {object_name} (key: {cache_key})")
    return cache_key

def update_cache_metadata(cache_key: str, metadata: Dict):
    """Update the global cache metadata file."""
    if CACHE_METADATA_FILE.exists():
        try:
            with open(CACHE_METADATA_FILE, 'r') as f:
                cache_index = json.load(f)
        except:
            cache_index = {}
    else:
        cache_index = {}
    
    cache_index[cache_key] = metadata
    
    with open(CACHE_METADATA_FILE, 'w') as f:
        json.dump(cache_index, f, indent=2)

def list_cached_models() -> Dict[str, Dict]:
    """List all cached models."""
    if not CACHE_METADATA_FILE.exists():
        return {}
    
    try:
        with open(CACHE_METADATA_FILE, 'r') as f:
            return json.load(f)
    except:
        return {}

def clear_cache():
    """Clear all cached models."""
    for file in CACHE_DIR.glob("*"):
        if file.is_file():
            file.unlink()
    print("[CACHE] Cleared all cached models")







