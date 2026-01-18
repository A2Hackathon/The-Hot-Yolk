"""Test Overshoot API key validity"""
import requests
import json

API_KEY = 'ovs_2d4ab5e6aa5d635976e707712176fe5b'
API_URL = 'https://cluster1.overshoot.ai/api/v0.2'

print(f"Testing Overshoot API key...")
print(f"Key preview: {API_KEY[:10]}...{API_KEY[-5:]}")
print(f"API URL: {API_URL}\n")

# Test 1: Try to create a stream (this is what the SDK does)
print("=" * 60)
print("TEST 1: Creating a stream (what the SDK does)")
print("=" * 60)

try:
    response = requests.post(
        f"{API_URL}/streams",
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json"
        },
        json={
            "prompt": "test",
            "source": {
                "type": "camera",
                "cameraFacing": "environment"
            }
        },
        timeout=10
    )
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Headers: {dict(response.headers)}")
    
    if response.status_code == 200:
        print("[SUCCESS] API key is VALID")
        print(f"Response: {response.text[:200]}")
    elif response.status_code == 401:
        print("[FAILED] API key is INVALID (401 Unauthorized)")
        print(f"Response: {response.text[:500]}")
    elif response.status_code == 403:
        print("[FAILED] API key is FORBIDDEN (403 - may not have permissions)")
        print(f"Response: {response.text[:500]}")
    elif response.status_code == 422:
        print("[VALIDATION ERROR] 422: API key might be valid, but request format is wrong")
        print(f"Full Response: {response.text}")
        print("\nThis is likely the issue - the request format might be incorrect.")
        print("The SDK might format the request differently than direct API calls.")
        
        # Try to parse error details
        try:
            error_data = response.json()
            print("\nParsed Error Data:")
            print(json.dumps(error_data, indent=2))
        except:
            pass
    else:
        print(f"[UNEXPECTED] Status: {response.status_code}")
        print(f"Response: {response.text[:500]}")
        
except requests.exceptions.Timeout:
    print("[TIMEOUT] Request took too long (>10 seconds)")
except requests.exceptions.ConnectionError:
    print("[CONNECTION ERROR] Cannot reach Overshoot API")
except Exception as e:
    print(f"[ERROR] {type(e).__name__}: {str(e)}")

print("\n" + "=" * 60)
