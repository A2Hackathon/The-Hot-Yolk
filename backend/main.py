from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import API routers
from api.routes.generate import router as generate_router
from api.routes.update import router as update_router
from api.routes.health import router as health_router
from api.routes.models import router as models_router


# Create FastAPI app
app = FastAPI(
    title="AI World Builder API",
    description="Voice-driven 3D world generation",
    version="1.0.0"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with frontend URL
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated assets (heightmaps, skyboxes, enemy textures)
app.mount("/assets", StaticFiles(directory="assets"), name="assets")

# Include routers
app.include_router(generate_router, prefix="/api")
app.include_router(update_router, prefix="/api")
app.include_router(health_router, prefix="/api")
app.include_router(models_router, prefix="/api")

@app.get("/")
async def root():
    """Basic info"""
    return {
        "name": "AI World Builder API",
        "version": "1.0.0",
        "status": "online",
        "docs": "/docs"
    }

# Run server if executed directly
if __name__ == "__main__":
    import uvicorn
    print("=" * 60)
    print("🌍 AI World Builder Backend Starting...")
    print(f"API Docs: http://localhost:8000/docs")
    print(f"Health Check: http://localhost:8000/api/health")
    print("=" * 60)
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True  # Auto-reload on code changes
    )
