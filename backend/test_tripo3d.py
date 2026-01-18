"""
TripoSR API Diagnostic Test
Run this to check if your TripoSR integration is working correctly.
TripoSR is faster than Tripo3D (~0.5 seconds vs 30-60 seconds) and uses image-to-3D.
"""
import os
import asyncio
import base64
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Import the function to test
from models.generators import generate_3d_model_triposr

async def test_triposr():
    """Test TripoSR API with a sample image"""
    print("=" * 60)
    print("TRIPOSR API DIAGNOSTIC TEST")
    print("=" * 60)
    
    # Check API key
    api_key = os.getenv("TRIPOSR_API_KEY") or os.getenv("AIMLAPI_KEY") or os.getenv("AIML_API_KEY")
    if not api_key:
        print("❌ FAILED: TRIPOSR_API_KEY, AIMLAPI_KEY, or AIML_API_KEY not set in .env file")
        print("💡 Add this line to backend/.env:")
        print("   TRIPOSR_API_KEY=your_key_here")
        print("   OR")
        print("   AIMLAPI_KEY=your_key_here")
        print("   OR")
        print("   AIML_API_KEY=your_key_here  (this is what you have)")
        print()
        print("💡 Get your key from: https://aimlapi.com/")
        return
    
    print(f"✅ API Key found: {api_key[:10]}...")
    print()
    
    # Test 1: Create a simple test image (1x1 pixel red image as base64)
    # In real usage, this would be a camera frame
    print("TEST 1: Generating 3D model from image (TripoSR - should take ~0.5 seconds)...")
    print("-" * 60)
    
    # Create a minimal test image (1x1 red pixel) as base64
    # Note: Real scans will use actual camera frames
    test_image_base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
    test_image_data = f"data:image/png;base64,{test_image_base64}"
    
    print("💡 Note: Using minimal test image. Real scans use actual camera frames.")
    print()
    
    # For testing, we need to provide an image_url or use ImgBB
    # Since test doesn't have backend running, we'll try without image_url (will fail gracefully)
    print("💡 Note: Test needs backend running for image hosting, or IMGBB_API_KEY set")
    print()
    
    model_url = await generate_3d_model_triposr(
        image_data=test_image_data,
        image_url=None,  # No backend URL for standalone test
        object_name="test_model"
    )
    
    if model_url:
        print()
        print("=" * 60)
        print("✅ SUCCESS! TripoSR is working correctly")
        print("=" * 60)
        print(f"Model URL: {model_url}")
        print()
        print("You can now use camera scanning in your app!")
        print("💡 TripoSR is much faster (~0.5 seconds) than Tripo3D (30-60 seconds)!")
    else:
        print()
        print("=" * 60)
        print("❌ FAILED! TripoSR generation failed")
        print("=" * 60)
        print()
        print("TROUBLESHOOTING STEPS:")
        print("1. Check if your API key is valid:")
        print("   - Log in to https://aimlapi.com/")
        print("   - Get your API key from dashboard")
        print("   - Verify your key is active")
        print()
        print("2. Check if you have credits:")
        print("   - AIMLAPI requires credits for TripoSR")
        print("   - Check your balance on the platform")
        print()
        print("3. Check network connectivity:")
        print("   - Can you access https://api.aimlapi.com?")
        print("   - Can you access https://api.imgbb.com (for image upload)?")
        print("   - Are you behind a firewall?")
        print()
        print("4. Check image upload:")
        print("   - ImgBB (free tier) is used for temporary image hosting")
        print("   - Image must be valid base64 encoded image")
        print()
        print("5. Look at the error logs above for specific error messages")
        print()
        print("NOTE: This test uses a minimal 1x1 pixel image.")
        print("Real camera scans will use actual camera frames for better results.")

if __name__ == "__main__":
    asyncio.run(test_triposr())
