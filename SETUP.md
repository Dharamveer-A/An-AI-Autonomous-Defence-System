# TerraVision — Setup Guide

## What you need

- Node.js 18 or later
- A free Groq API key (https://console.groq.com/keys)
- No other accounts or API keys required

---

## Steps to run in VS Code

### 1. Open the project folder

Open VS Code. Go to File > Open Folder and select the `terra-vision-fixed` folder.

### 2. Open the integrated terminal

Press Ctrl + ` (backtick) to open the terminal inside VS Code.

### 3. Copy the environment file

In the terminal, run:

```
cd backend
copy .env.example .env
```

On Mac/Linux use `cp` instead of `copy`.

### 4. Add your Groq API key

Open `backend/.env` in VS Code. Replace `your_groq_api_key_here` with your actual key from https://console.groq.com/keys

The file should look like:
```
PORT=3000
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
```

### 5. Install dependencies

In the terminal (make sure you are inside the `backend` folder):

```
npm install
```

### 6. Start the server

```
npm run dev
```

You should see:
```
TerraVision server running at http://localhost:3000
```

### 7. Open the app

Open your browser and go to: http://localhost:3000

---

## How to use

1. Click "Open Map"
2. The map loads in satellite view. Navigate to any area on Earth.
3. Click the rectangle draw tool (top-left toolbar on the map) and draw a box over your area of interest.
4. Set the "From" and "To" dates (default is 5 years apart).
5. Click "Analyse Area".
6. Wait 15-30 seconds for imagery to load and the AI to analyse it.

---

## Image sources (automatic, no setup needed)

The app tries these in order until one works:

1. **Microsoft Planetary Computer** — free Sentinel-2 imagery at 10m resolution
2. **Copernicus Data Space** — free Sentinel-2 imagery
3. **NASA GIBS MODIS** — free 250m imagery, always available as a fallback

---

## Google Earth Engine (optional)

GEE is not required. If you want to use it:

1. Sign up at https://earthengine.google.com/
2. Install Python dependencies: `pip install flask earthengine-api`
3. Authenticate: `earthengine authenticate` (opens a browser)
4. In a second terminal: `cd backend && python gee_server.py`
5. It runs on port 5001 and the app detects it automatically

---

## Troubleshooting

**"GROQ_API_KEY not set" error**
- Make sure you created the `.env` file in the `backend` folder (not the root folder)
- Make sure the key starts with `gsk_`

**Analysis shows "JSON parse failed" in logs**
- This is fixed in this version. If it still happens, check the Raw AI Response section in the result panel.

**Images show as grey / no satellite imagery visible**
- Try selecting a larger area (zoom out a bit before drawing)
- Try a date range that ends at least 3-6 months ago — very recent dates may have no archive coverage
- Summer dates (June-September in the northern hemisphere) have less cloud cover

**Port 3000 already in use**
- Change `PORT=3001` in the `.env` file and restart
