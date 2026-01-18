# 🔧 TripoSR Troubleshooting Guide

## 📊 **Current Issue**

Your console shows:
```
[FALLBACK/OPENAI] ✅ Frame #1 analyzed - Biome: room
[SCAN] Using legacy world generation (scan may have failed)
```

This means:
- ✅ OpenAI scene analysis is working
- ❌ TripoSR 3D generation is failing
- ⚠️ System falling back to legacy world generation

---

## 🔍 **How to Diagnose**

### **Step 1: Check Backend Terminal**

When you scan, watch your **backend terminal** (where `uvicorn` is running) for these messages:

#### ✅ **Success Pattern:**
```
[SCAN] 📸 Analyzing entire scene for 3D generation...
[SCAN] ✅ Scene analyzed: A black coffee maker...
[SCAN] 🎨 Generating complete 3D world from image using TripoSR...
[TripoSR] 📤 Uploading image to temporary storage (ImgBB)...
[TripoSR] ✅ Image uploaded to ImgBB: https://...
[TripoSR] 📤 Sending to AIMLAPI TripoSR (fast image-to-3D, ~0.5 seconds)...
[TripoSR] ✅ Model generated successfully! (~0.5 seconds - very fast!)
[TripoSR] 📦 Model URL: https://...
[SCAN] ✅ Complete 3D world generated: https://...
```

#### ❌ **Failure Patterns:**

**1. ImgBB Upload Failed:**
```
[TripoSR] ❌ ImgBB upload failed: 429
[TripoSR] 💡 Error details: Rate limit exceeded
[TripoSR] 💡 Solution: Get free ImgBB API key from https://api.imgbb.com/ or wait 1 minute
```
**Fix:** Get free ImgBB API key or wait 1 minute

**2. AIMLAPI Authentication Failed:**
```
[TripoSR] ❌ AIMLAPI request failed: 401
[TripoSR] 💡 401 Unauthorized - Check if AIML_API_KEY is valid
```
**Fix:** Check your `AIML_API_KEY` in `.env` file

**3. No Credits:**
```
[TripoSR] ❌ AIMLAPI request failed: 402
[TripoSR] 💡 402 Payment Required - Check if you have credits in AIMLAPI account
```
**Fix:** Add credits to your AIMLAPI account

**4. Rate Limited:**
```
[TripoSR] ❌ AIMLAPI request failed: 429
[TripoSR] 💡 429 Rate Limited - Wait a minute and try again
```
**Fix:** Wait 1 minute between scans

---

## 🔧 **Common Fixes**

### **Issue 1: ImgBB Upload Failing**

**Problem:** `[TripoSR] ❌ ImgBB upload failed: 429`

**Solution:**
1. Get a free ImgBB API key:
   - Go to https://api.imgbb.com/
   - Sign up / Log in
   - Get your API key
   - Add to `backend/.env`:
     ```bash
     IMGBB_API_KEY=your_imgbb_key_here
     ```

2. **OR** wait 1 minute (rate limit resets)

---

### **Issue 2: AIMLAPI Authentication Failed**

**Problem:** `[TripoSR] ❌ AIMLAPI request failed: 401`

**Check:**
1. Verify `AIML_API_KEY` in `backend/.env`:
   ```bash
   AIML_API_KEY=080844074acb469399c581dd49cff3dd
   ```

2. Verify key is correct:
   - Go to https://aimlapi.com/
   - Log in
   - Check your API key in dashboard
   - Make sure it matches `.env` file

3. Restart backend:
   ```bash
   # Stop backend (Ctrl+C)
   # Start again
   uvicorn main:app --reload --port 8000
   ```

---

### **Issue 3: No Credits**

**Problem:** `[TripoSR] ❌ AIMLAPI request failed: 402`

**Solution:**
1. Go to https://aimlapi.com/
2. Log in
3. Check your credit balance
4. Add credits if needed

---

### **Issue 4: API Key Not Found**

**Problem:** `[TripoSR] ❌ TRIPOSR_API_KEY, AIMLAPI_KEY, or AIML_API_KEY not set`

**Solution:**
1. Check `backend/.env` file exists
2. Verify it contains:
   ```bash
   AIML_API_KEY=080844074acb469399c581dd49cff3dd
   ```
3. Make sure there are no extra spaces or quotes
4. Restart backend

---

## 🧪 **Testing**

### **Test TripoSR Directly:**

```bash
cd backend
python test_tripo3d.py
```

**Expected output:**
```
✅ API Key found: 08084407...
✅ SUCCESS! TripoSR is working correctly
Model URL: https://...
```

**If it fails:**
- Check backend terminal for detailed error
- Follow the error message to fix the issue

---

## 📋 **Checklist**

Before scanning, verify:

- [ ] Backend server is running (`uvicorn main:app --reload`)
- [ ] Backend terminal is visible (to see error logs)
- [ ] `AIML_API_KEY` is set in `backend/.env`
- [ ] API key is valid (test with `python test_tripo3d.py`)
- [ ] AIMLAPI account has credits
- [ ] Internet connection is working
- [ ] (Optional) `IMGBB_API_KEY` is set for better reliability

---

## 🎯 **Quick Fix Summary**

**Most common issues:**

1. **ImgBB rate limit** → Get free ImgBB API key or wait 1 minute
2. **Invalid AIML_API_KEY** → Verify key in `.env` matches dashboard
3. **No credits** → Add credits to AIMLAPI account
4. **Network error** → Check internet connection

**Quick test:**
```bash
cd backend
python test_tripo3d.py
```

This will show you exactly what's wrong!

---

## 📚 **For More Help**

- **Backend logs:** Check your `uvicorn` terminal for detailed errors
- **Frontend console:** Check browser console (F12) for error messages
- **Test script:** Run `python backend/test_tripo3d.py` for diagnostics

---

## 🎉 **When It Works**

You'll see in backend terminal:
```
[TripoSR] ✅ Model generated successfully! (~0.5 seconds - very fast!)
[TripoSR] 📦 Model URL: https://...
[SCAN] ✅ Complete 3D world generated: https://...
```

And in frontend console:
```
[FALLBACK/OPENAI] ✅ TripoSR model generated: https://...
[SCAN] 🎨 Loading complete scanned 3D environment...
```

**Result:** 3D environment appears instead of legacy room! 🎉
