print("="*80)
print("[MAIN.PY] MODULE LOADING - Middleware should be registered")
print("="*80)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

# Import API routers
from api.routes.generate import router as generate_router
from api.routes.update import router as update_router
from api.routes.health import router as health_router
from api.routes.scan import router as scan_router

print("[MAIN.PY] Routers imported")

# Create FastAPI app
app = FastAPI(
    title="AI World Builder API",
    description="Voice-driven 3D world generation",
    version="1.0.0"
)

print("[MAIN.PY] FastAPI app created")

# Debug: Log all incoming requests FIRST (before CORS)
from starlette.requests import Request
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware
import sys

print("[MAIN.PY] About to register middleware...")

# Use BaseHTTPMiddleware for guaranteed execution - NO EMOJIS (Windows encoding issue)
class LoggingMiddleware(BaseHTTPMiddleware):
    def __init__(self, app):
        print("[MIDDLEWARE] LoggingMiddleware.__init__ called!")
        super().__init__(app)
    
    async def dispatch(self, request: Request, call_next):
        # Force flush to ensure output appears
        import sys
        sys.stdout.flush()
        
        path = request.url.path
        method = request.method
        
        # Use plain text - no emojis for Windows compatibility
        print(f"\n{'='*80}", flush=True)
        print(f"[MIDDLEWARE] {method} {path}", flush=True)
        print(f"[MIDDLEWARE] Client: {request.client}", flush=True)
        
        if path.startswith("/api"):
            print(f"[MIDDLEWARE] *** API REQUEST DETECTED ***", flush=True)
        
        try:
            response = await call_next(request)
            print(f"[MIDDLEWARE] Response: {method} {path} -> {response.status_code}", flush=True)
            print(f"{'='*80}\n", flush=True)
            return response
        except Exception as e:
            print(f"[MIDDLEWARE] ERROR: {e}", flush=True)
            import traceback
            traceback.print_exc()
            raise

try:
    app.add_middleware(LoggingMiddleware)
    print("[MAIN.PY] Middleware registered successfully!", flush=True)
except Exception as e:
    print(f"[MAIN.PY] ERROR registering middleware: {e}", flush=True)
    import traceback
    traceback.print_exc()

print("="*80, flush=True)

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
app.include_router(scan_router, prefix="/api")

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
    print("AI World Builder Backend Starting...")
    print(f"API Docs: http://localhost:8000/docs")
    print(f"Health Check: http://localhost:8000/api/health")
    print("=" * 60)
    
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=8000,
        reload=True  # Auto-reload on code changes
    )
