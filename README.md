# 🌍 TerraVision — AI Satellite Change Analysis

Select any area on a map → fetch historical satellite images → AI analyses what changed.

---

## 🗂 Project Structure

```
terra-vision/
├── frontend/
│   ├── index.html          ← Main webpage
│   ├── css/style.css       ← All styles
│   └── js/
│       ├── app.js          ← Screen navigation + state
│       ├── map.js          ← Leaflet map + rectangle draw
│       └── analysis.js     ← Fetch images + show AI results
│
└── backend/
    ├── server.js           ← Express server (entry point)
    ├── package.json        ← Node dependencies
    ├── .env.example        ← Copy to .env and fill in keys
    ├── gee_server.py       ← Python microservice for GEE images
    │
    ├── routes/
    │   ├── images.js       ← POST /api/images/fetch
    │   └── analysis.js     ← POST /api/analysis/compare
    │
    └── services/
        ├── imageService.js   ← Calls GEE Python server / NASA GIBS fallback
        └── analysisService.js ← Calls Groq API for vision analysis
```

---

## ⚡ Quick Start (3 steps)

### Step 1 — Get your API Keys

#### 🤖 Groq API Key (REQUIRED for AI analysis)
1. Go to **https://console.groq.com/keys**
2. Sign up (free) → Create API Key
3. Copy the key — you'll need it for `.env`

#### 🛰 Google Earth Engine (for best satellite images)
1. Go to **https://earthengine.google.com/**
2. Click "Get Started" → register with a Google account
3. Wait for approval (usually instant for personal use)
4. After approval, on your computer run:
   ```bash
   pip install earthengine-api flask Pillow requests
   earthengine authenticate
   ```
   This opens a browser to authenticate your Google account.

> **Without GEE:** The app automatically falls back to **NASA GIBS/MODIS** imagery
> (always works, no auth, lower resolution). You can skip GEE setup initially.

---

### Step 2 — Configure environment

```bash
cd terra-vision/backend
cp .env.example .env
```

Open `.env` and fill in:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxx
```

---

### Step 3 — Install & Run

#### Terminal 1 — Node.js Backend
```bash
cd terra-vision/backend
npm install
npm run dev
```
Server starts at **http://localhost:3000**

#### Terminal 2 — GEE Python Server (optional but recommended)
```bash
cd terra-vision/backend
python gee_server.py
```
Runs at **http://localhost:5001**

#### Open the app
Browse to **http://localhost:3000**

---

## 🔄 How It Works

```
User draws rectangle on map
         ↓
POST /api/images/fetch
         ↓
Node.js → asks Python GEE server (port 5001)
         ↓ (if GEE unavailable)
Fallback → NASA GIBS WMS (always works)
         ↓
Returns: before image URL + after image URL
         ↓
POST /api/analysis/compare
         ↓
Node.js sends both images to Groq API
(model: llama-3.2-11b-vision-preview)
         ↓
Groq returns JSON: summary, changes[], metrics{}, severity
         ↓
Frontend renders the comparison report
```

---

## 🧑‍💻 Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | HTML + CSS + Vanilla JS |
| Map | Leaflet.js + OpenStreetMap (CartoDB Dark) |
| Rectangle Draw | Leaflet.draw plugin |
| Backend | Node.js + Express |
| AI Analysis | Groq API (llama-3.2-11b-vision-preview) |
| Satellite Images | Google Earth Engine (primary) |
| Image Fallback | NASA GIBS / MODIS Terra (no auth needed) |
| GEE Bridge | Python Flask microservice |

---

## 🛰 Satellite Image Sources

### Primary: Google Earth Engine
- **Dataset:** Sentinel-2 SR Harmonized (COPERNICUS/S2_SR_HARMONIZED)
- **Resolution:** 10 meters/pixel
- **Coverage:** 2015–present
- **Cloud filtering:** Auto-selects least cloudy image in date range
- **Auth:** One-time `earthengine authenticate`

### Fallback: NASA GIBS / MODIS Terra
- **Dataset:** MODIS Terra CorrectedReflectance TrueColor
- **Resolution:** ~250 meters/pixel
- **Coverage:** 2000–present
- **Auth:** None required
- **Note:** Lower resolution but globally available

---

## 🤖 AI Model

**Groq:** `llama-3.2-11b-vision-preview`
- Accepts two images (before + after)
- Returns structured JSON: summary, changes, metrics, severity, environmental impact
- Falls back to `llama-3.3-70b-versatile` (text) if vision model is unavailable

---

## ❓ Troubleshooting

### "GROQ_API_KEY is not set"
→ Make sure you created a `.env` file from `.env.example` and added your key.

### "GEE not initialized"
→ Run `earthengine authenticate` in your terminal.
→ Or just ignore — the app will use NASA GIBS as fallback automatically.

### Images show as blank/broken
→ This is normal for some regions with heavy cloud cover.
→ Try a different date range or a different area.
→ Coastlines and cities work best.

### "Cannot GET /"
→ Make sure you're running `npm run dev` inside the `backend/` folder.
→ The server serves frontend from `../frontend/`.

### Port already in use
→ Change `PORT=3000` in `.env` to `PORT=3001` (or any free port).

---

## 🔮 Good Areas to Try

| Location | Coordinates | Why Interesting |
|----------|-------------|-----------------|
| Amazon rainforest | -3°S, -60°W | Deforestation tracking |
| Las Vegas | 36°N, -115°W | Urban expansion |
| Aral Sea | 45°N, 59°E | Water loss |
| Dubai coast | 25°N, 55°E | Land reclamation |
| Himalayan glaciers | 28°N, 86°E | Glacier retreat |
| Kerala floods area | 9°N, 76°E | Flood/recovery |

---

## 📦 Dependencies

### Node.js (backend/package.json)
```json
{
  "express":    "HTTP server + routing",
  "cors":       "Cross-origin requests",
  "dotenv":     "Environment variables",
  "groq-sdk":   "Groq AI API client",
  "axios":      "HTTP requests (image fetch)",
  "multer":     "File upload handling",
  "node-fetch": "Fetch API for Node",
  "nodemon":    "Dev auto-restart (devDep)"
}
```

### Python (gee_server.py)
```
flask             HTTP microservice
earthengine-api   Google Earth Engine SDK
Pillow            Image processing
requests          HTTP client
```

---

## 📄 License
MIT — Free to use and modify.
