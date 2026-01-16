import requests

def test(url):
    print(f"Testing {url}...")
    try:
        response = requests.post(url, json={})
        print(f"Status Code: {response.status_code}")
        print(f"Response: {response.text[:200]}")
    except Exception as e:
        print(f"Error: {e}")
    print("-" * 20)

test("http://127.0.0.1:8001/api/scan-world")
test("http://127.0.0.1:8001/test")
test("http://127.0.0.1:8001/api/generate-world")
test("http://localhost:8000/docs") # GET request
