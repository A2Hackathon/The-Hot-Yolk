# 🔧 Camera Scan Troubleshooting Guide

## ❌ Problem: Black Screen After Scanning

### Symptoms
- Overshoot SDK captures detailed scene descriptions ✅
- Console shows: `Model URL: undefined` ❌
- Falls back to legacy generation (shows nothing) ❌
- Black screen with no 3D world ❌

---

## 🔍 Root Cause

**Tripo3D API is failing** to generate the 3D model. The frontend shows `Model URL: undefined` because the backend's Tripo3D call returned `None`.

---

## ✅ Solution Steps

### Step 1: Run the Diagnostic Test

Open a terminal in the backend folder and run:

```bash
cd backend
python test_tripo3d.py
```

This will:
- ✅ Check if `TRIPO3D_API_KEY` is set
- ✅ Test a simple 3D generation
- ✅ Show detailed error messages
- ✅ Provide specific troubleshooting steps

**Expected output if working:**
```
✅ SUCCESS! Tripo3D is working correctly
Model URL: https://...model.glb
```

**If it fails, you'll see specific error messages pointing to the issue.**

---

### Step 2: Check Backend Logs

**The backend terminal is WHERE THE REAL ERROR IS!**

When you run camera scanning, watch your **backend terminal** (where FastAPI is running) for these messages:

#### ✅ Success Pattern:
```
[SCAN] 📸 Analyzing entire scene for 3D generation...
[SCAN] ✅ Scene analyzed: A black coffee maker...
[SCAN] 🎨 Generating complete 3D world from scene...
[Tripo3D] 🚀 Generating 3D model for 'scanned_environment'...
[Tripo3D] 📋 Task created: task_xyz123
[Tripo3D] ⏳ Waiting for generation (may take 30-60 seconds)...
[Tripo3D] ⏳ Still generating... (10s elapsed)
[Tripo3D] ✅ Model generated successfully!
[Tripo3D] 📦 Model URL: https://...
```

#### ❌ Failure Patterns:

**1. API Key Missing/Invalid:**
```
[Tripo3D] ❌ TRIPO3D_API_KEY not set in environment
```
**Fix:** Add `TRIPO3D_API_KEY=your_key` to `backend/.env`

**2. Task Creation Failed:**
```
[Tripo3D] ❌ Task creation failed: 401 - Unauthorized
```
**Fix:** Your API key is invalid. Get a new one from https://platform.tripo3d.ai/

**3. Timeout:**
```
[Tripo3D] ⏰ Timeout after 120 seconds
```
**Fix:** Tripo3D is overloaded or the scene description is too complex. Try again in a few minutes.

**4. Generation Failed:**
```
[Tripo3D] ❌ Generation failed: insufficient_credits
```
**Fix:** Add credits to your Tripo3D account.

**5. No Model URL:**
```
[Tripo3D] ❌ No model URL in response: {...}
```
**Fix:** Tripo3D API returned success but no model. Contact Tripo3D support.

---

### Step 3: Check Frontend Console

Starting now, your **frontend console** will show more helpful messages:

```
[OVERSHOOT] ⚠️ Backend Error: Tripo3D generation failed - check backend logs
[OVERSHOOT] 💡 SOLUTION: Check your backend terminal/console for detailed error
[OVERSHOOT] 💡 Common causes: API timeout (>2min), rate limit, invalid API key
[OVERSHOOT] ⚠️ No model URL received from backend - falling back to legacy
```

**Always check BOTH frontend AND backend logs!**

---

## 🔥 Common Issues & Fixes

### Issue 1: "No Backend Terminal"

**Problem:** You can't find the backend terminal to see error logs.

**Solution:** 
1. Open a new terminal in VS Code (Ctrl+`)
2. Navigate to backend: `cd backend`
3. Start backend: `uvicorn main:app --reload --port 8000`
4. Keep this terminal visible while testing

---

### Issue 2: "API Key is Set But Still Fails"

**Problem:** Diagnostic test shows API key, but generation still fails.

**Solution:**
1. Go to https://platform.tripo3d.ai/
2. Log in to your account
3. Check **Credits Balance** - you need credits!
4. If balance is 0, purchase credits or use free trial
5. Verify your API key is **not expired**

---

### Issue 3: "Timeout After 120 Seconds"

**Problem:** Tripo3D is taking too long (>2 minutes).

**Solution:**
1. **Wait and retry** - API might be overloaded
2. **Simplify the scan** - scan smaller/simpler objects first
3. **Check API status** - Visit Tripo3D status page
4. **Increase timeout** - Edit `backend/models/generators.py`:
   ```python
   max_attempts = 90  # 90 * 2 = 3 minutes
   ```

---

### Issue 4: "Rate Limited"

**Problem:** Tripo3D says "rate limit exceeded"

**Solution:**
1. Wait 1 minute between scan attempts
2. Check your Tripo3D plan's rate limits
3. Upgrade to higher tier if needed
4. Use caching (already implemented) - scan same object twice uses cache

---

### Issue 5: "Network Error"

**Problem:** `[Tripo3D] ❌ Network error: Connection refused`

**Solution:**
1. Check internet connection
2. Verify `https://api.tripo3d.ai` is accessible
3. Check firewall/proxy settings
4. Try from different network

---

## 📊 How to Read the Logs

### Good Flow (Working):
```
Frontend: [OVERSHOOT] 🎬 Generating complete 3D world from scene...
Backend:  [SCAN] 🎨 Generating complete 3D world from scene...
Backend:  [Tripo3D] 🚀 Generating 3D model...
Backend:  [Tripo3D] ⏳ Waiting for generation...
Backend:  [Tripo3D] ✅ Model generated successfully!
Frontend: [OVERSHOOT] ✅ Complete 3D world generated!
Frontend: [OVERSHOOT] Model URL: https://...
Frontend: [SCAN] Loading scanned world...
          → Shows 3D environment ✅
```

### Bad Flow (Broken):
```
Frontend: [OVERSHOOT] 🎬 Generating complete 3D world from scene...
Backend:  [SCAN] 🎨 Generating complete 3D world from scene...
Backend:  [Tripo3D] ❌ TRIPO3D_API_KEY not set        ← ERROR HERE!
Backend:  [SCAN] ⚠️ Tripo3D generation failed...
Frontend: [OVERSHOOT] ✅ Complete 3D world generated! (misleading)
Frontend: [OVERSHOOT] Model URL: undefined             ← THE SYMPTOM
Frontend: [OVERSHOOT] ⚠️ Backend Error: Tripo3D...     ← NEW ERROR MSG
Frontend: [SCAN] Using legacy world generation...
          → Black screen ❌
```

---

## 🎯 Quick Checklist

Before scanning, verify:

- [ ] Backend server is running (`uvicorn main:app --reload`)
- [ ] Backend terminal is visible (to see errors)
- [ ] `TRIPO3D_API_KEY` is set in `backend/.env`
- [ ] API key is valid (test with `python test_tripo3d.py`)
- [ ] Tripo3D account has credits
- [ ] Internet connection is working
- [ ] No rate limiting (wait 1 min between scans)

---

## 🆘 Still Not Working?

### Option 1: Test with Simple Object First

Before scanning your environment, test with a simple object:

```bash
cd backend
python test_tripo3d.py
```

If this fails, **fix this first** before trying camera scanning.

### Option 2: Check API Status

- Visit https://platform.tripo3d.ai/status
- Check if API is operational
- Look for any service disruptions

### Option 3: Use Fallback (Temporary)

While debugging, you can temporarily disable Tripo3D and use AI primitives:

1. Edit `backend/api/routes/scan.py`
2. Comment out Tripo3D call
3. Use AI-generated primitives instead

**(Not recommended - you lose full scene generation)**

---

## 📝 What Changed

### Before (Silent Failure):
- Tripo3D fails → No error shown → Confusion

### After (Helpful Errors):
- Tripo3D fails → Frontend shows error + solution hints
- Tripo3D fails → Backend logs detailed error
- Diagnostic script available to test API
- This troubleshooting guide!

---

## 🎓 Understanding the Flow

```
Camera Scan
    ↓
Frontend: Captures frames with Overshoot SDK
    ↓
Frontend: Sends snapshot to backend `/scan-world`
    ↓
Backend: Analyzes with OpenAI Vision (scan_entire_scene_with_vision)
    ↓
Backend: Gets detailed scene description ✅
    ↓
Backend: Calls Tripo3D API (generate_3d_model_tripo3d)
    ↓
Backend: Creates task, waits for GLB model (30-120s)
    ↓
Backend: Returns model_url to frontend
    ↓
Frontend: Loads GLB model and displays 3D world ✅

IF Tripo3D fails at any step:
    ↓
Backend: Returns model_url: None + error message
    ↓
Frontend: Shows error in console
    ↓
Frontend: Falls back to legacy generation (empty room)
```

**Your issue:** Tripo3D is failing between "Creates task" and "Returns model_url"

**Solution:** Run diagnostic test to find exact failure point!

---

## 🚀 Next Steps

1. **Run the test:** `cd backend && python test_tripo3d.py`
2. **Read the output** - it will tell you exactly what's wrong
3. **Fix the issue** based on the error message
4. **Try scanning again** - it should work now!

Good luck! 🎉
