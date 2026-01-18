"""Test if middleware is actually intercepting requests"""
import requests
import time

print("Testing middleware...")
print("Calling /api/health endpoint...")

try:
    response = requests.get("http://localhost:8000/api/health", timeout=5)
    print(f"Status: {response.status_code}")
    print(f"Response: {response.json()}")
    print("\nCheck your backend terminal - you should see [MIDDLEWARE] logs!")
    print("If you don't see [MIDDLEWARE] logs, the middleware isn't working.")
except Exception as e:
    print(f"Error: {e}")
