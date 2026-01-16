from fastapi import FastAPI
from api.routes.generate import router as generate_router
from main import app

print("Routes:")
for route in app.routes:
    if hasattr(route, "methods"):
        print(f"{route.methods} {route.path}")
    else:
        print(f"Mount: {route.path}")

