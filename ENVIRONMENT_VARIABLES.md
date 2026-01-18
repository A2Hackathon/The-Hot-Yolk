# Environment Variables Configuration

This document describes all environment variables used in the Game_App project.

## Backend Environment Variables

Create a `.env` file in the `backend/` directory with the following variables:

### Required Variables

#### **OPENAI_API_KEY** or **OPENROUTER_API_KEY**
- **Required for:** Camera scanning (OpenAI Vision API)
- **Format:** `sk-...` (OpenAI) or `sk-or-...` (OpenRouter)
- **Used by:** 
  - `backend/world/overshoot_integration.py` - AI vision analysis
  - `backend/models/generators.py` - AI template generation
- **Get API Key:**
  - OpenAI: https://platform.openai.com/api-keys
  - OpenRouter: https://openrouter.ai/keys
- **Example:**
  ```bash
  OPENAI_API_KEY=sk-proj-abc123...
  # OR
  OPENROUTER_API_KEY=sk-or-v1-abc123...
  ```

### Optional Variables (Camera Scanning Enhancement)

#### **TRIPO3D_API_KEY** ⭐ NEW - Priority 1
- **Required for:** Ultra-realistic 3D model generation from scanned objects
- **Format:** String (get from Tripo3D dashboard)
- **Used by:**
  - `backend/models/generators.py` - `generate_3d_model_tripo3d()`
  - `backend/api/routes/generate.py` - `generate_scanned_object()`
- **What it does:**
  - Generates photorealistic GLB 3D models from text descriptions
  - Provides the highest quality scanned objects (Priority 1)
  - Falls back to AI primitives if not set or fails
- **Get API Key:**
  - Website: https://platform.tripo3d.ai/
  - Sign up and navigate to API Keys section
  - Free tier available with limited generations
- **Example:**
  ```bash
  TRIPO3D_API_KEY=your_tripo3d_api_key_here
  ```
- **Performance:**
  - Generation time: 30-60 seconds per object
  - Output: High-quality GLB models with textures and PBR materials
  - Polygon count: 10,000 faces (optimized for games)

#### **OVERSHOOT_API_KEY**
- **Required for:** Real-time video streaming analysis (Mode 1)
- **Format:** String starting with `ovs_`
- **Used by:**
  - Frontend: `App.jsx` - Overshoot SDK integration
  - Provides real-time video analysis via streaming
- **Get API Key:** https://overshoot.ai/
- **Example:**
  ```bash
  OVERSHOOT_API_KEY=ovs_abc123...
  ```
- **Note:** Currently hardcoded in frontend (`App.jsx` line 11). Move to environment variable for production.

### Optional Variables (3D Model Generation)

These are alternative 3D generation APIs. Tripo3D is recommended as Priority 1.

#### **STABILITY_AI_API_KEY**
- **Required for:** Stability AI 3D model generation (experimental)
- **Status:** Not yet implemented (placeholder exists)
- **Get API Key:** https://platform.stability.ai/
- **Example:**
  ```bash
  STABILITY_AI_API_KEY=sk-...
  ```

#### **LUMA_AI_API_KEY**
- **Required for:** Luma AI Genie 3D model generation
- **Status:** Implemented but untested
- **Get API Key:** https://lumalabs.ai/
- **Example:**
  ```bash
  LUMA_AI_API_KEY=luma-...
  ```

#### **REPLICATE_API_TOKEN**
- **Required for:** Replicate API (hosts Shap-E and other 3D models)
- **Status:** Implemented but untested
- **Get API Key:** https://replicate.com/
- **Example:**
  ```bash
  REPLICATE_API_TOKEN=r8_...
  ```

## Frontend Environment Variables

Create a `.env` file in the `frontend/` directory:

### **VITE_API_BASE_URL** (Optional)
- **Required for:** Custom backend API URL
- **Default:** `http://localhost:8000/api`
- **Used by:** Frontend API calls
- **Example:**
  ```bash
  VITE_API_BASE_URL=https://your-backend.com/api
  ```

## Complete Example `.env` Files

### Backend (Minimum Required)
```bash
# Required for camera scanning
OPENAI_API_KEY=sk-proj-abc123...

# Optional: Enable Tripo3D for best quality 3D models
TRIPO3D_API_KEY=your_tripo3d_key_here

# Optional: Real-time video streaming (Overshoot)
OVERSHOOT_API_KEY=ovs_abc123...
```

### Backend (Full Setup with All Options)
```bash
# Vision AI (Required - choose one)
OPENAI_API_KEY=sk-proj-abc123...
# OR
OPENROUTER_API_KEY=sk-or-v1-abc123...

# 3D Model Generation (Priority Order)
TRIPO3D_API_KEY=your_tripo3d_key_here          # Priority 1 (Recommended)
REPLICATE_API_TOKEN=r8_abc123...                # Priority 2
LUMA_AI_API_KEY=luma-abc123...                  # Priority 3
STABILITY_AI_API_KEY=sk-abc123...               # Priority 4

# Video Analysis
OVERSHOOT_API_KEY=ovs_abc123...
```

### Frontend
```bash
# Optional: Custom backend URL
VITE_API_BASE_URL=http://localhost:8000/api
```

## Priority System for Object Generation

When a camera scan detects an object (e.g., "coffee maker"), the system tries these methods in order:

1. **Tripo3D API** ✅ BEST QUALITY
   - Requires: `TRIPO3D_API_KEY`
   - Output: Photorealistic GLB models with textures
   - Time: 30-60 seconds per object
   - Status: ✅ Fully implemented

2. **AI-Generated Primitives** ✅ GOOD QUALITY
   - Requires: `OPENAI_API_KEY` or `OPENROUTER_API_KEY`
   - Output: GPT designs using geometric shapes (box, cylinder, sphere, cone)
   - Time: 1-2 seconds per object
   - Status: ✅ Fully implemented

3. **Predefined Templates** ✅ RELIABLE
   - Requires: Nothing (built-in)
   - Output: 20+ hand-crafted object templates
   - Time: Instant
   - Status: ✅ 20+ templates available

4. **Generic Box** ⚠️ LAST RESORT
   - Requires: Nothing
   - Output: Simple colored cube
   - Time: Instant
   - Status: ✅ Always works

## Testing Your Setup

### Test Camera Scanning (Minimum)
```bash
# In backend/.env
OPENAI_API_KEY=sk-proj-...

# Start backend
cd backend
python -m uvicorn main:app --reload

# Start frontend
cd frontend
npm run dev

# Open http://localhost:3000
# Click "Start Video Streaming"
# Point camera at objects
```

### Test with Tripo3D (Best Quality)
```bash
# In backend/.env
OPENAI_API_KEY=sk-proj-...
TRIPO3D_API_KEY=your_tripo3d_key

# Backend logs should show:
# [Tripo3D] 🚀 Generating 3D model for 'coffee_maker'...
# [Tripo3D] ✅ Model generated successfully!
# [OBJECT] ✅ Priority 1 SUCCESS: Tripo3D generated model
```

## Troubleshooting

### Camera Not Working
- **Error:** "Camera permission denied"
- **Solution:** Use `http://localhost:3000` (NOT `http://192.168.x.x:3000`)
- **Reason:** Browsers require HTTPS or localhost for camera access

### OpenAI Vision Fails
- **Error:** `[VISION] ❌ Neither OPENAI_API_KEY nor OPENROUTER_API_KEY set`
- **Solution:** Add API key to `backend/.env`
- **Check:** Restart backend after adding environment variables

### Tripo3D Not Generating
- **Symptom:** Objects use primitive shapes instead of GLB models
- **Check:**
  1. Is `TRIPO3D_API_KEY` set in `backend/.env`?
  2. Backend logs show: `[Tripo3D] ❌ TRIPO3D_API_KEY not set in environment`
  3. API key is valid (test at https://platform.tripo3d.ai/)
- **Normal Behavior:** Falls back to Priority 2/3/4 if Tripo3D fails

### Overshoot Streaming Fails
- **Symptom:** Camera works but no real-time analysis
- **Fallback:** System automatically falls back to OpenAI Vision (frame-by-frame)
- **Check:** Frontend console shows `[OVERSHOOT] Falling back to OpenAI frame analysis...`

## Security Best Practices

1. **Never commit `.env` files** to git
   - Already in `.gitignore`
   
2. **Use different keys for development/production**
   - Rotate keys regularly
   
3. **Keep API keys secret**
   - Don't share in screenshots or logs
   
4. **Use environment-specific keys**
   - Development: Test keys with rate limits
   - Production: Production keys with higher limits

## Cost Estimates (Approximate)

### OpenAI Vision
- **Model:** gpt-4o-mini with vision
- **Cost:** ~$0.00015 per image (640x480)
- **Typical scan:** 3-5 images = $0.0005-0.001

### Tripo3D
- **Free Tier:** 10-50 generations/month
- **Paid Tier:** ~$0.10-0.50 per model
- **Generation:** Once per unique object (cached)

### Overshoot
- **Pricing:** Contact Overshoot.ai
- **Free Tier:** May be available

## Support

For API-specific issues:
- OpenAI: https://help.openai.com/
- Tripo3D: https://platform.tripo3d.ai/docs
- Overshoot: https://overshoot.ai/support

For application issues:
- Check backend logs: `backend/` terminal output
- Check frontend logs: Browser console (F12)
- Review implementation: `CAMERA_SCAN_IMPLEMENTATION_STATUS.md`
