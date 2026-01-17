# OpenAI Vision API Setup Guide

This guide will help you set up OpenAI Vision API for image analysis in the world generation system.

## Prerequisites

1. **OpenAI API Key**: You need an OpenAI API key that has access to GPT-4o-mini or GPT-4o models
   - Get your API key from: https://platform.openai.com/api-keys
   - Make sure your account has access to vision models (gpt-4o-mini or gpt-4o)

## Installation

1. **Install the OpenAI package** (if not already installed):
   ```bash
   cd backend
   pip install openai
   ```
   
   Or if using requirements.txt:
   ```bash
   pip install -r requirements.txt
   ```

2. **Verify installation**:
   ```bash
   python -c "import openai; print('OpenAI installed:', openai.__version__)"
   ```

## Configuration

1. **Add your OpenAI API key to `.env` file**:
   
   Open `backend/.env` and add:
   ```env
   OPENAI_API_KEY=sk-your-openai-api-key-here
   ```
   
   **Important**: Replace `sk-your-openai-api-key-here` with your actual API key from OpenAI.

2. **Verify the key is loaded**:
   
   Restart your backend server and check the console output. You should see:
   ```
   [VISION] OpenAI API key loaded (length: XX characters)
   ```

## How It Works

When you scan the world with your camera:

1. **Image Capture**: The frontend captures an image from your camera (needs to be >10,000 characters for valid base64 image)
2. **OpenAI Vision Analysis**: The backend sends the image to OpenAI Vision API for detailed analysis
3. **World Generation**: The analysis is converted to world parameters (biome, objects, colors, etc.)
4. **Enhanced Accuracy**: If Overshoot streaming description is also available, both are combined for maximum accuracy

## Current Status

To check if OpenAI Vision is working:

1. **Check backend logs** when scanning:
   - If working: `[VISION] Using OpenAI Vision API...`
   - If missing key: `[VISION] ❌ OPENAI_API_KEY not set in environment`
   - If image too small: `[VISION] ❌ Image data too small: XX chars (expected >1000 for valid base64 image)`

2. **Check your `.env` file**:
   ```bash
   # Windows PowerShell
   cd backend
   Get-Content .env | Select-String "OPENAI_API_KEY"
   ```

## Troubleshooting

### Issue: "OPENAI_API_KEY not set in environment"

**Solution**: 
- Make sure `OPENAI_API_KEY=sk-...` is in `backend/.env`
- Restart the backend server after adding the key
- The `.env` file should be in the `backend/` directory, not the root

### Issue: "Image data too small"

**Solution**:
- This means the camera image capture is failing (only getting ~3435 chars instead of >10,000)
- The system will automatically fall back to using Overshoot streaming description only
- Check your camera permissions and make sure the video stream is working

### Issue: OpenAI API errors (401, 403, etc.)

**Solution**:
- Verify your API key is correct and active at https://platform.openai.com/api-keys
- Make sure your account has credits/quota available
- Check that your key has access to vision models (gpt-4o-mini or gpt-4o)

### Issue: "ModuleNotFoundError: No module named 'openai'"

**Solution**:
```bash
cd backend
pip install openai
```

## Testing

To test if OpenAI Vision is working, you can:

1. **Start the backend** and check for the initialization message:
   ```
   [VISION] OpenAI API key loaded (length: XX characters)
   ```

2. **Try scanning** with a valid camera image:
   - If the image is valid (>10,000 chars), OpenAI Vision will analyze it
   - Check backend logs for: `[VISION] Using OpenAI Vision API...`
   - Should see: `[VISION] [OK] OpenAI Vision analyzed image successfully`

## API Costs

- **GPT-4o-mini**: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
- **GPT-4o**: ~$2.50 per 1M input tokens, ~$10 per 1M output tokens
- Image analysis typically uses 1000-2000 tokens per request

**Recommended**: Use `gpt-4o-mini` (already configured) for cost-effective analysis.

## Example `.env` File

```env
# OpenAI API Key (for Vision analysis)
OPENAI_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Overshoot API Key (for streaming video analysis)
OVERSHOOT_API_KEY=ovs_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
OVERSHOOT_API_URL=https://cluster1.overshoot.ai/api/v0.2

# Other API keys...
GROQ_API_KEY=...
ELEVENLABS_API_KEY=...
```

## Notes

- OpenAI Vision API is used for **detailed single image analysis**
- Overshoot AI SDK is used for **streaming video analysis** (real-time descriptions)
- When both are available, the system combines them for maximum accuracy
- If image capture fails, the system automatically falls back to Overshoot description only
