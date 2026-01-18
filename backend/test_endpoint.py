"""
Quick test script to verify backend endpoint is accessible
"""
import requests
import json
import base64

# Create a small test image (1x1 pixel red PNG)
test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="

# Add data URL prefix
test_image_data = f"data:image/png;base64,{test_image_base64}"

print("Testing backend endpoint...")
print(f"URL: http://localhost:8000/api/scan-world")

try:
    response = requests.post(
        "http://localhost:8000/api/scan-world",
        json={"image_data": test_image_data},
        headers={"Content-Type": "application/json"},
        timeout=10
    )
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    print(f"Response Body: {response.text[:500]}")
    
    if response.status_code == 200:
        data = response.json()
        print(f"\n[SUCCESS] Response keys: {list(data.keys())}")
        if "world" in data:
            print(f"   World type: {data.get('world', {}).get('type', 'unknown')}")
    else:
        print(f"\n[ERROR] Status: {response.status_code}")
        
except requests.exceptions.ConnectionError:
    print("\n[ERROR] Cannot connect to backend!")
    print("   Make sure backend is running on http://localhost:8000")
except Exception as e:
    print(f"\n[ERROR] {e}")
