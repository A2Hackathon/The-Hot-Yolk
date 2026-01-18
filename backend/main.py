print("="*80)
print("[MAIN.PY] MODULE LOADING - Middleware should be registered")
print("="*80)

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles  # Fixed: removed duplicate import
from contextlib import asynccontextmanager
import asyncio
import signal
import sys

# Import API routers
from api.routes.generate import router as generate_router
from api.routes.update import router as update_router
from api.routes.health import router as health_router
from api.routes.scan import router as scan_router

print("[MAIN.PY] Routers imported")

# Global shutdown flag
shutdown_event = asyncio.Event()

# Lifespan context manager for graceful startup/shutdown
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Handle application lifespan: startup and shutdown events.
    Provides graceful shutdown with proper cleanup.
    """
    # Startup
    print("=" * 60)
    print("[LIFESPAN] Application starting up...")
    print("=" * 60)
    
    # Setup signal handlers for graceful shutdown
    def signal_handler(signum, frame):
        """Handle shutdown signals gracefully"""
        signal_name = signal.Signals(signum).name
        print(f"\n[SHUTDOWN] Received {signal_name} signal, initiating graceful shutdown...")
        shutdown_event.set()
    
    # Register signal handlers (SIGINT = Ctrl+C, SIGTERM = termination)
    if sys.platform != "win32":
        # Unix/Linux/Mac
        signal.signal(signal.SIGINT, signal_handler)
        signal.signal(signal.SIGTERM, signal_handler)
    else:
        # Windows
        signal.signal(signal.SIGINT, signal_handler)
        # Windows doesn't support SIGTERM, but we'll handle it if available
        if hasattr(signal, 'SIGTERM'):
            signal.signal(signal.SIGTERM, signal_handler)
    
    print("[LIFESPAN] Signal handlers registered")
    print("[LIFESPAN] Application ready")
    
    yield  # Application runs here
    
    # Shutdown
    print("\n" + "=" * 60)
    print("[LIFESPAN] Application shutting down...")
    print("[LIFESPAN] Cleaning up resources...")
    
    # Cancel any running tasks
    try:
        # Get all running tasks
        tasks = [task for task in asyncio.all_tasks() if not task.done()]
        if tasks:
            print(f"[LIFESPAN] Cancelling {len(tasks)} running task(s)...")
            for task in tasks:
                task.cancel()
            
            # Wait for tasks to complete cancellation (with timeout)
            await asyncio.gather(*tasks, return_exceptions=True)
    except asyncio.CancelledError:
        # Expected during shutdown
        pass
    except Exception as e:
        print(f"[LIFESPAN] Warning during cleanup: {e}")
    
    print("[LIFESPAN] Shutdown complete")
    print("=" * 60)

# Create FastAPI app with lifespan
app = FastAPI(
    title="AI World Builder API",
    description="Voice-driven 3D world generation",
    version="1.0.0",
    lifespan=lifespan
)

print("[MAIN.PY] FastAPI app created")

# Debug: Log all incoming requests FIRST (before CORS)
from starlette.requests import Request
from starlette.responses import Response
from starlette.middleware.base import BaseHTTPMiddleware

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
    
    def handle_exception(exc_type, exc_value, exc_traceback):
        """
        Custom exception handler to suppress CancelledError during shutdown
        """
        # Suppress CancelledError and KeyboardInterrupt during shutdown
        if issubclass(exc_type, (asyncio.CancelledError, KeyboardInterrupt)):
            # Only print if not already shutting down gracefully
            if not shutdown_event.is_set():
                print(f"\n[SHUTDOWN] {exc_type.__name__}: Initiating graceful shutdown...")
            return
        # Use default exception handler for other exceptions
        sys.__excepthook__(exc_type, exc_value, exc_traceback)
    
    # Set custom exception handler
    sys.excepthook = handle_exception
    
    print("=" * 60)
    print("AI World Builder Backend Starting...")
    print(f"API Docs: http://localhost:8000/docs")
    print(f"Health Check: http://localhost:8000/api/health")
    print(f"Press Ctrl+C to stop the server gracefully")
    print("=" * 60)
    
    try:
        uvicorn.run(
            "main:app",
            host="0.0.0.0",
            port=8000,
            reload=True,  # Auto-reload on code changes
            log_level="info"
        )
    except KeyboardInterrupt:
        # This will be caught and handled gracefully by lifespan
        print("\n[SHUTDOWN] KeyboardInterrupt received, shutting down...")
    except Exception as e:
        print(f"\n[SHUTDOWN] Unexpected error during shutdown: {e}")
        raise
    finally:
        print("\n[SHUTDOWN] Server stopped")