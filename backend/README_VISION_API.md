# Vision API Setup for World Scanning

The world scanning feature uses AI vision APIs to analyze captured images and generate 3D worlds.

## Recommended: OpenAI Vision API

**Best for:** Single image analysis (what we need for camera capture)

1. Get an API key from https://platform.openai.com/api-keys
2. Add to `backend/.env`:
   ```
   OPENAI_API_KEY=sk-your-key-here
   ```
3. Restart the backend server

OpenAI Vision will automatically analyze images and extract:
- Objects (trees, rocks, buildings, etc.)
- Terrain type and biome
- Weather conditions
- Color palettes
- Spatial relationships

## Alternative: Overshoot AI

**Note:** Overshoot AI SDK (`@overshoot/sdk`) is designed for **real-time video streaming**, not single image analysis. If Overshoot provides a REST API endpoint for single images, you can use it:

1. Get an API key from https://overshoot.ai
2. Add to `backend/.env`:
   ```
   OVERSHOOT_API_KEY=your-key-here
   OVERSHOOT_API_URL=https://api.overshoot.ai/v1/analyze
   ```
3. Restart the backend server

**Important:** The current Overshoot SDK documentation shows it's for streaming video, not single image analysis. For camera capture of a single frame, OpenAI Vision is the recommended approach.

## Fallback Mode

If no API keys are set, the system uses mock/fallback data for testing purposes.

## Testing

After setting up your API key, try scanning your environment:
1. Click "Scan Real World" in the frontend
2. Allow camera access
3. Capture an image
4. The AI will analyze it and generate a 3D world

Check the backend console for detailed logs showing which API is being used.
