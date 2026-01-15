"""
Test script to discover the correct Overshoot AI API endpoint.
This script will try multiple endpoint patterns and show which ones work.
"""
import os
import requests
from dotenv import load_dotenv

load_dotenv()

API_KEY = os.getenv("OVERSHOOT_API_KEY")
if not API_KEY:
    print("[ERROR] OVERSHOOT_API_KEY not found in .env file")
    print("Please add OVERSHOOT_API_KEY=your_key_here to backend/.env")
    exit(1)

print(f"[OK] API Key found (length: {len(API_KEY)} characters)")
print(f"[KEY] Key preview: {API_KEY[:10]}...{API_KEY[-5:]}\n")

# Test endpoints to try
ENDPOINTS_TO_TEST = [
    "https://api.overshoot.ai/v1/analyze",
    "https://api.overshoot.ai/v1/environment/scan",
    "https://api.overshoot.ai/v1/vision/analyze",
    "https://api.overshoot.ai/analyze",
    "https://api.overshoot.ai/environment/scan",
    "https://overshoot.ai/api/v1/analyze",
    "https://overshoot.ai/api/analyze",
    "https://overshoot.ai/api/v1/environment/scan",
]

print("[TEST] Testing Overshoot AI endpoints...\n")
print("=" * 70)

working_endpoints = []
failed_endpoints = []

for endpoint in ENDPOINTS_TO_TEST:
    print(f"\n[TEST] Testing: {endpoint}")
    
    headers = {
        "Authorization": f"Bearer {API_KEY}",
        "Content-Type": "application/json"
    }
    
    # Try a minimal test payload (you may need to adjust this based on actual API)
    test_payload = {
        "image": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",  # 1x1 pixel PNG
        "test": True
    }
    
    try:
        response = requests.post(
            endpoint,
            headers=headers,
            json=test_payload,
            timeout=10
        )
        
        print(f"   Status: {response.status_code}")
        
        if response.status_code == 200:
            print(f"   [SUCCESS] This endpoint works!")
            print(f"   Response preview: {response.text[:200]}")
            working_endpoints.append(endpoint)
        elif response.status_code == 401:
            print(f"   [WARN] Authentication failed (401) - API key might be invalid")
            print(f"   But endpoint exists! Response: {response.text[:200]}")
            working_endpoints.append((endpoint, "auth_failed"))
        elif response.status_code == 404:
            print(f"   [FAIL] Not found (404)")
            failed_endpoints.append((endpoint, "404"))
        elif response.status_code == 400:
            print(f"   [WARN] Bad request (400) - Endpoint exists but payload format wrong")
            print(f"   Response: {response.text[:200]}")
            working_endpoints.append((endpoint, "format_error"))
        else:
            print(f"   [WARN] Status {response.status_code}: {response.text[:200]}")
            failed_endpoints.append((endpoint, f"status_{response.status_code}"))
            
    except requests.exceptions.ConnectionError as e:
        print(f"   [FAIL] Connection failed: DNS resolution error")
        failed_endpoints.append((endpoint, "connection_error"))
    except requests.exceptions.Timeout:
        print(f"   [FAIL] Timeout after 10 seconds")
        failed_endpoints.append((endpoint, "timeout"))
    except Exception as e:
        print(f"   [FAIL] Error: {e}")
        failed_endpoints.append((endpoint, str(e)))

print("\n" + "=" * 70)
print("\n[RESULTS] SUMMARY:\n")

if working_endpoints:
    print("[SUCCESS] WORKING ENDPOINTS:")
    for endpoint_info in working_endpoints:
        if isinstance(endpoint_info, tuple):
            endpoint, note = endpoint_info
            print(f"   * {endpoint} ({note})")
        else:
            print(f"   * {endpoint}")
    print("\n[TIP] Add this to your backend/.env file:")
    if isinstance(working_endpoints[0], tuple):
        print(f"   OVERSHOOT_API_URL={working_endpoints[0][0]}")
    else:
        print(f"   OVERSHOOT_API_URL={working_endpoints[0]}")
else:
    print("[FAIL] NO WORKING ENDPOINTS FOUND")
    print("\nPossible issues:")
    print("   1. The API endpoint URL pattern is different")
    print("   2. The API requires a different authentication method")
    print("   3. The API is not publicly accessible")
    print("   4. You need to check Overshoot AI documentation or contact support")
    
    if failed_endpoints:
        print("\n   Contact Overshoot AI support and ask for:")
        print("   - The correct REST API endpoint URL")
        print("   - The expected request format")
        print("   - Authentication method (Bearer token vs other)")

print("\n" + "=" * 70)
print("\n[TIP] ALTERNATIVE: Use OpenAI Vision API instead")
print("   Add to backend/.env:")
print("   OPENAI_API_KEY=sk-your-openai-key")
print("   (This will automatically be used if Overshoot fails)")
