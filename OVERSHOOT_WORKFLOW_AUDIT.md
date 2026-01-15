# Overshoot AI Integration - Complete Workflow Audit

## Overview
This document maps the complete workflow of the Overshoot AI integration, covering all systems, data flows, and potential issues.

---

## Systems Using Overshoot AI

### 1. **Frontend Streaming System** (`frontend/src/App.jsx`)
- **Purpose**: Real-time video streaming analysis using Overshoot SDK
- **Entry Point**: `startCameraCapture()` → `startOvershootStreaming()`
- **Key Components**:
  - `RealtimeVision` from `@overshoot/sdk`
  - API key input via `window.prompt()`
  - Streaming callbacks (`onResult`, `onError`)
  - Result processing via `processStreamingResult()`

### 2. **Frontend Single Image System** (`frontend/src/App.jsx`)
- **Purpose**: Capture single frame and analyze
- **Entry Point**: `captureAndScanWorld()`
- **Flow**: Camera → Canvas → Base64 → Backend API

### 3. **Backend Streaming Handler** (`backend/api/routes/generate.py`)
- **Purpose**: Process streaming analysis results from SDK
- **Endpoint**: `POST /api/scan-world`
- **Handles**: `request.use_streaming = true` path

### 4. **Backend Single Image Handler** (`backend/api/routes/generate.py`)
- **Purpose**: Analyze single image with OpenAI Vision or Overshoot REST
- **Endpoint**: `POST /api/scan-world`
- **Handles**: `request.image_data` path

### 5. **Backend Vision Integration** (`backend/world/overshoot_integration.py`)
- **Purpose**: Core vision analysis logic
- **Functions**:
  - `analyze_with_openai_vision()` - OpenAI Vision API
  - `analyze_environment()` - Main entry point (prioritizes OpenAI)
  - `parse_overshoot_response()` - Format normalization
  - `generate_world_from_scan()` - Convert scan to world params

---

## Complete Workflow Diagrams

### **Workflow 1: Real-Time Video Streaming (Overshoot SDK)**

```
┌─────────────────────────────────────────────────────────────────┐
│ USER ACTION: Clicks "📹 Start Video Streaming"                  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ startCameraCapture()                                            │
│ - Checks camera permissions                                     │
│ - Prompts for Overshoot API key (window.prompt)                 │
│ - Cleans API key (removes whitespace/newlines)                  │
│ - Validates API key format (length >= 10)                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ startOvershootStreaming(apiKey)                                 │
│ - Creates RealtimeVision instance                               │
│ - Config: apiUrl='https://api.overshoot.ai'                     │
│ - Config: backend='overshoot'                                   │
│ - Config: model='Qwen/Qwen3-VL-30B-A3B-Instruct'                │
│ - Config: outputSchema (JSON structure)                         │
│ - Config: source={type: 'camera', cameraFacing: 'environment'}  │
│ - Config: processing (sampling_ratio: 0.1, fps: 30, etc.)      │
│ - Sets up callbacks: onResult, onError                          │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ vision.start()                                                  │
│ - SDK connects to api.overshoot.ai                              │
│ - Starts video stream capture                                   │
│ - Processes frames (10% sampling rate)                          │
│ - Analyzes video with vision model                              │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ SDK Callback: onResult(result)                                  │
│ - Receives analysis from SDK                                    │
│ - Parses JSON (handles both string and object)                  │
│ - Sets lastScanResult state                                     │
│ - Calls processStreamingResult(analysis)                        │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ processStreamingResult(analysis)                                │
│ - Formats data: { streaming_analysis: analysis,                 │
│                  use_streaming: true }                          │
│ - POST to /api/scan-world                                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND: POST /api/scan-world                                   │
│ Request: {                                                       │
│   use_streaming: true,                                          │
│   streaming_analysis: { objects: [...], terrain: {...}, ... }   │
│ }                                                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Backend: scan_world() handler                                   │
│ - Detects use_streaming flag                                    │
│ - Checks if streaming_analysis has "biome" key                  │
│   → If YES: use directly                                        │
│   → If NO: parse through parse_overshoot_response()             │
│ - Validates: requires "biome" and "objects" keys                │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ generate_world_from_scan(scan_data)                             │
│ - Extracts: biome, objects, colors, spatial_layout              │
│ - Builds structure_counts dict                                  │
│ - Adjusts counts based on biome                                 │
│ - Determines time_of_day from weather/colors                    │
│ - Returns: { biome, time, structure, enemy_count, weapon }      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ World Generation Pipeline                                       │
│ - generate_heightmap()                                          │
│ - generate_mountain_peaks()                                     │
│ - generate_trees_with_colors()                                  │
│ - generate_rocks()                                              │
│ - generate_buildings()                                          │
│ - generate_street_lamps()                                       │
│ - generate_enemies()                                            │
│ - generate_lighting_config()                                    │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Response to Frontend                                            │
│ {                                                                │
│   world: { biome, lighting_config, heightmap_raw, ... },        │
│   structures: { trees: [...], rocks: [...], ... },              │
│   combat: { enemies: [...] },                                   │
│   spawn_point: { x, z }                                         │
│ }                                                               │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Frontend: loadWorldFromScan(data)                               │
│ - Sets currentWorld state                                       │
│ - Clears existing scene objects                                 │
│ - Creates ground/terrain                                        │
│ - Applies lighting                                              │
│ - Loads all structures (trees, rocks, peaks, buildings, etc.)   │
│ - Places player at spawn                                        │
│ - Loads enemies                                                 │
│ - Sets gameState to PLAYING                                     │
└─────────────────────────────────────────────────────────────────┘
```

### **Workflow 2: Single Image Analysis (Legacy/Fallback)**

```
┌─────────────────────────────────────────────────────────────────┐
│ USER ACTION: Clicks "Scan Real World" (legacy button)           │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ captureAndScanWorld()                                           │
│ - Captures frame from video canvas                              │
│ - Converts to Base64: canvas.toDataURL('image/jpeg')            │
│ - POST to /api/scan-world with image_data                       │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ BACKEND: POST /api/scan-world                                   │
│ Request: { image_data: "data:image/jpeg;base64,/9j/4AAQ..." }   │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ Backend: scan_world() handler                                   │
│ - Detects image_data (not streaming)                            │
│ - Validates image_data length (>= 100 chars)                    │
│ - Calls analyze_environment(image_data)                         │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ analyze_environment(image_data)                                 │
│ Priority Order:                                                 │
│   1. Try OpenAI Vision API (if OPENAI_API_KEY set)              │
│   2. Try Overshoot REST endpoint (if OVERSHOOT_API_KEY set)     │
│   3. Fallback to mock data                                      │
└──────────────────────────────┬──────────────────────────────────┘
                               │
        ┌──────────────────────┴──────────────────────┐
        │                                             │
        ▼                                             ▼
┌───────────────────────────┐          ┌───────────────────────────┐
│ analyze_with_openai_vision│          │ Overshoot REST API        │
│ - OpenAI API call         │          │ - POST to                 │
│ - Model: gpt-4o-mini      │          │   api.overshoot.ai/v1/    │
│ - Returns parsed JSON     │          │   analyze                 │
│ - Calls                   │          │ - Handles various HTTP    │
│   parse_overshoot_response│          │   status codes (401, 404) │
└──────────────┬────────────┘          │ - Calls                   │
               │                       │   parse_overshoot_response│
               └───────────┬───────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│ parse_overshoot_response(raw_response)                          │
│ - Normalizes different response formats                         │
│ - Extracts objects (handles list/dict formats)                  │
│ - Maps terrain to biome                                         │
│ - Extracts colors (handles palette/dominant formats)            │
│ - Returns standardized format:                                  │
│   { biome, objects, colors, spatial_layout, weather, terrain }  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│ [Continues same as Workflow 1 from generate_world_from_scan]    │
│ ... → generate_world_from_scan() → World Generation → Response  │
└─────────────────────────────────────────────────────────────────┘
```

---

## API Key Management

### Frontend (Streaming)
- **Location**: User input via `window.prompt()`
- **Storage**: Not stored, only used during session
- **Cleaning**: Removes `\r\n`, `\r`, `\n`, whitespace
- **Validation**: Length >= 10 characters
- **Error Handling**: Falls back to `startBasicCamera()` if invalid

### Backend
- **Location**: Environment variables (`.env` file)
- **Variables**:
  - `OPENAI_API_KEY` - For single image analysis (recommended)
  - `OVERSHOOT_API_KEY` - For Overshoot REST endpoint (if exists)
  - `OVERSHOOT_API_URL` - Default: `https://api.overshoot.ai/v1/analyze`
- **Loading**: `load_dotenv()` in `overshoot_integration.py`
- **Error Handling**: Falls back to mock data if both keys missing

---

## Data Format Transformations

### 1. SDK Output Format
```json
{
  "objects": [
    {"type": "tree", "count": 5},
    {"type": "rock", "count": 3}
  ],
  "terrain": {"type": "arctic"},
  "weather": {"condition": "snowy"},
  "colors": {"palette": ["#FFFFFF", "#2d5016"]},
  "spatial_layout": [...]
}
```

### 2. Parsed Format (after `parse_overshoot_response`)
```json
{
  "biome": "arctic",
  "objects": {"tree": 5, "rock": 3},
  "colors": ["#FFFFFF", "#2d5016"],
  "spatial_layout": [...],
  "weather": "snowy",
  "terrain_type": "mountainous"
}
```

### 3. World Params Format (after `generate_world_from_scan`)
```json
{
  "biome": "arctic",
  "time": "noon",
  "structure": {
    "tree": 15,
    "rock": 8,
    "building": 0,
    "mountain": 3,
    "street_lamp": 0
  },
  "tree_colors": {
    "leaf_color": "#2d5016",
    "trunk_color": "#8b4513"
  },
  "enemy_count": 3,
  "weapon": "both"
}
```

### 4. Backend Response Format (to frontend)
```json
{
  "world": {
    "biome": "arctic",
    "lighting_config": {...},
    "heightmap_raw": [[...], [...]],
    "colour_map_array": [[...], [...]]
  },
  "structures": {
    "trees": [{position: {...}, scale: 1.0, ...}, ...],
    "rocks": [...],
    "peaks": [...],
    "buildings": [...],
    "street_lamps": [...]
  },
  "combat": {
    "enemies": [{id: 1, position: {...}, ...}, ...]
  },
  "spawn_point": {"x": 0, "z": 0}
}
```

---

## Error Handling Points

### Frontend Errors

1. **Camera Access**
   - Not supported browser → Alert message
   - Not HTTPS/localhost → Redirect prompt
   - Permission denied → Detailed error message
   - Device not found → Detailed error message

2. **API Key Input**
   - Empty/invalid → Falls back to basic camera
   - Format validation → Alert + fallback

3. **Streaming Errors**
   - SDK start() fails → Error alert + fallback to basic camera
   - DNS resolution fails → Detailed error message
   - Authentication fails → Error callback logging

4. **Result Processing**
   - JSON parse error → Logs error, continues
   - Backend error → Alert with details
   - Network error → Alert with details

### Backend Errors

1. **Image Analysis**
   - No API keys → Returns mock data
   - OpenAI API fails → Tries Overshoot REST
   - Overshoot REST fails → Returns mock data
   - Connection errors → Detailed logging + mock data
   - Parse errors → Detailed logging + None return

2. **Scan Processing**
   - Missing/invalid scan_data → HTTPException 500
   - Missing required keys → HTTPException 500 with details
   - Format validation → HTTPException 500

3. **World Generation**
   - Standard error handling in generation functions
   - Missing heightmap → Returns empty/default

---

## Potential Issues & Recommendations

### ✅ **Current Strengths**
1. Dual-path support (streaming + single image)
2. Robust error handling with fallbacks
3. Flexible format parsing
4. Good logging for debugging
5. API key validation and cleaning

### ⚠️ **Potential Issues**

1. **Streaming Data Format Mismatch**
   - **Issue**: Backend checks if `streaming_analysis` has `"biome"` key, but SDK output might not always include it
   - **Status**: ✅ Fixed - Now handles both cases with fallback parsing

2. **API Key Storage**
   - **Issue**: Frontend API key is not persisted (prompted every time)
   - **Recommendation**: Consider localStorage (with user consent) or backend proxy

3. **Overshoot REST Endpoint Uncertainty**
   - **Issue**: `api.overshoot.ai` DNS resolution may fail (endpoint may not be public)
   - **Status**: ✅ Handled - Falls back to OpenAI Vision or mock data

4. **Rate Limiting**
   - **Issue**: No rate limiting on streaming or API calls
   - **Recommendation**: Add request throttling/debouncing

5. **Memory Leaks**
   - **Issue**: `overshootVisionRef.current` may not be cleaned up properly
   - **Status**: ✅ Fixed - Cleanup in `stopCameraCapture()`

6. **Concurrent Streaming**
   - **Issue**: Multiple streaming instances could conflict if user clicks button rapidly
   - **Status**: ✅ Fixed - Added guard in `startCameraCapture()` to check `streamingActive` and `overshootVisionRef.current`

### 🔧 **Recommended Improvements**

1. **Add Request Debouncing**
   ```javascript
   // In processStreamingResult, debounce API calls
   const debouncedProcess = debounce(processStreamingResult, 1000);
   ```

2. **Persist API Key (Optional)**
   ```javascript
   // Store in localStorage with user consent
   if (userConsents) {
     localStorage.setItem('overshoot_api_key', apiKey);
   }
   ```

3. **Add Streaming Status Indicator**
   - Show visual indicator when streaming is active
   - Display frame rate, connection status

4. **Improve Error Messages**
   - More specific error codes
   - Actionable suggestions for users

5. **Add Metrics/Logging**
   - Track API call success rates
   - Monitor streaming performance
   - Log errors to analytics service

---

## Testing Checklist

- [x] Streaming path: User input → SDK → Backend → World render
- [x] Single image path: Capture → Backend → World render
- [x] API key validation (frontend)
- [x] API key loading (backend)
- [x] Format parsing (multiple formats)
- [x] Error handling (all failure points)
- [x] Fallback mechanisms (mock data)
- [x] Camera permissions
- [x] HTTPS/localhost detection
- [x] Memory cleanup

---

## Files Involved

### Frontend
- `frontend/src/App.jsx` (Lines: 2358-2965, 2637-2950)
- `frontend/package.json` (Dependency: `@overshoot/sdk`)

### Backend
- `backend/api/routes/generate.py` (Lines: 712-938)
- `backend/world/overshoot_integration.py` (All 587 lines)
- `backend/requirements.txt` (Dependency: `openai`)

### Documentation
- `backend/README_VISION_API.md`

### Testing
- `backend/test_overshoot_api.py`

---

## Summary

The Overshoot AI integration is **well-structured** with:
- ✅ Two complete workflow paths (streaming + single image)
- ✅ Robust error handling and fallbacks
- ✅ Flexible data format parsing
- ✅ Good separation of concerns
- ✅ Comprehensive logging

**Status**: ✅ Production-ready with minor recommendations for enhancement.
