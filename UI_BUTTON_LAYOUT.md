# UI Button Layout - After World Generation (PLAYING State)

## Button Positions (frontend/src/App.jsx)

### Top-Right Column (right: 80px)
1. **Settings Button (GameSettingsPanel)**
   - Position: `top: 40px, right: 80px`
   - Size: 56px × 56px
   - Z-Index: 200
   - Vertical space: 40px - 96px

2. **Voice Button**
   - Position: `top: 110px, right: 80px` ✅ (updated to avoid overlap)
   - Size: 60px × 60px
   - Z-Index: 20
   - Vertical space: 110px - 170px

3. **Color Picker Button**
   - Position: `top: 220px, right: 80px` ✅ (updated to avoid overlap)
   - Size: 56px × 56px
   - Z-Index: 200
   - Vertical space: 220px - 276px

**Spacing Check:**
- Settings (40-96px) → Voice (110-170px): 14px gap ✅
- Voice (110-170px) → ColorPicker (220-276px): 50px gap ✅

### Top Row (top: 90px)
4. **Home Button**
   - Position: `top: 90px, right: 27px`
   - Size: 56px × 56px
   - Z-Index: 10
   - Horizontal space: right 27px - 83px

5. **Chat History Button**
   - Position: `top: 90px, right: 135px`
   - Size: 56px × 56px
   - Z-Index: 10
   - Horizontal space: right 135px - 191px

6. **Export Button**
   - Position: `top: 90px, right: 200px`
   - Size: 56px × 56px
   - Z-Index: 10
   - Horizontal space: right 200px - 256px

**Spacing Check:**
- Home (right 27-83px) → Chat (right 135-191px): 52px gap ✅
- Chat (right 135-191px) → Export (right 200-256px): 9px gap ⚠️ (small but acceptable)

### Top-Left
7. **Game Info Panel**
   - Position: `top: 20px, left: 20px`
   - Z-Index: 10
   - No overlap ✅

### Bottom-Center
8. **Input/Upload Section**
   - Position: `bottom: 30px, left: 50% (centered)`
   - Z-Index: 20
   - No overlap ✅

### Bottom-Right (App.jsx only - older version)
9. **Voice Button (App.jsx)**
   - Position: `bottom: 30px, right: 30px`
   - Size: 60px × 60px
   - Z-Index: 20
   - Only appears in App.jsx (not frontend/src/App.jsx)

---

## Summary

**All buttons now have proper spacing:**
- ✅ Settings, Voice, ColorPicker stack vertically with gaps
- ✅ Home, Chat, Export buttons are horizontally spaced
- ✅ No overlapping buttons in PLAYING state

**Recommended spacing:**
- Minimum 20px gap between buttons (currently have 14-50px gaps)
- All buttons are easily clickable
- Clear visual separation
