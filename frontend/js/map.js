// TerraVision — Map Controller
// Basemap: ESRI World Imagery (free, no key)
// Draw: Leaflet.draw rectangle tool
// Purpose: Select any region for general land cover change analysis

let mapInst     = null;
let drawnItems  = null;
let zoomGuideEl = null;

const TILE_LAYERS = {
  satellite: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics', maxZoom: 19 }
  ),
  satelliteLabels: L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Labels © Esri', maxZoom: 19, opacity: 0.7 }
  ),
  street: L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
  )
};

let currentBaseLayer = null;
let labelsLayer      = null;

// ── Zoom level → guidance text ───────────────────────────────────────────────
const ZOOM_GUIDE = [
  { min: 0,  max: 5,  icon: '🌍', text: 'Continental view — zoom in more before drawing', quality: 'too-wide' },
  { min: 6,  max: 7,  icon: '🗺️', text: 'Country/state level — good for coastlines & large forests', quality: 'ok' },
  { min: 8,  max: 9,  icon: '🛰️', text: 'Regional view (~200 km) — good for Amazon, Aral Sea, flood zones', quality: 'good' },
  { min: 10, max: 11, icon: '🛰️', text: 'District level (~50 km) — good for urban expansion & reservoirs', quality: 'good' },
  { min: 12, max: 13, icon: '✅', text: 'Optimal zoom — draw here for best Sentinel-2 (10m) results', quality: 'best' },
  { min: 14, max: 15, icon: '✅', text: 'Detailed view — ideal for GEE Sentinel-2, see fields & roads', quality: 'best' },
  { min: 16, max: 99, icon: '⚠️', text: 'Too zoomed in — area too small for meaningful change detection', quality: 'too-close' }
];

function getZoomGuide(zoom) {
  return ZOOM_GUIDE.find(g => zoom >= g.min && zoom <= g.max) || ZOOM_GUIDE[0];
}

function updateZoomGuide(zoom) {
  if (!zoomGuideEl) return;
  const g = getZoomGuide(zoom);
  zoomGuideEl.innerHTML  = `<span class="zg-icon">${g.icon}</span> <span>${g.text}</span>`;
  zoomGuideEl.className  = `zoom-guide zg-${g.quality}`;
}

// ── Init map ─────────────────────────────────────────────────────────────────
function initMap() {
  if (mapInst) { mapInst.invalidateSize(); return; }

  mapInst = L.map('map', { center: [20, 0], zoom: 3, zoomControl: true });

  TILE_LAYERS.satellite.addTo(mapInst);
  currentBaseLayer = 'satellite';
  TILE_LAYERS.satelliteLabels.addTo(mapInst);
  labelsLayer = TILE_LAYERS.satelliteLabels;

  // Draw layer
  drawnItems = new L.FeatureGroup().addTo(mapInst);

  const drawCtrl = new L.Control.Draw({
    edit: { featureGroup: drawnItems, edit: false, remove: true },
    draw: {
      rectangle: {
        shapeOptions: {
          color:       '#4A90D9',
          weight:      2.5,
          fillColor:   '#4A90D9',
          fillOpacity: 0.10
        }
      },
      polygon:      false,
      polyline:     false,
      circle:       false,
      marker:       false,
      circlemarker: false
    }
  });
  mapInst.addControl(drawCtrl);

  // ── Zoom guide bar ─────────────────────────────────────────────────────────
  zoomGuideEl = document.createElement('div');
  zoomGuideEl.className = 'zoom-guide';
  document.getElementById('map').appendChild(zoomGuideEl);
  updateZoomGuide(mapInst.getZoom());

  mapInst.on('zoomend', () => updateZoomGuide(mapInst.getZoom()));

  // ── Draw events ────────────────────────────────────────────────────────────
  mapInst.on(L.Draw.Event.CREATED, e => {
    drawnItems.clearLayers();

    const layer  = e.layer;
    const bounds = layer.getBounds();

    // ── Rectangle label showing area & zoom advice ──────────────────────────
    const center   = bounds.getCenter();
    const kmLat    = Math.abs(bounds.getNorth() - bounds.getSouth()) * 111;
    const kmLng    = Math.abs(bounds.getEast()  - bounds.getWest())  * 111
                     * Math.cos(center.lat * Math.PI / 180);
    const areaSqKm = (kmLat * kmLng).toFixed(1);
    const zoom     = mapInst.getZoom();
    const guide    = getZoomGuide(zoom);

    // Colour rectangle based on quality
    const qualityColor = {
      'best':      '#22c55e',
      'good':      '#4A90D9',
      'ok':        '#f59e0b',
      'too-wide':  '#ef4444',
      'too-close': '#ef4444'
    }[guide.quality] || '#4A90D9';

    layer.setStyle({ color: qualityColor, fillColor: qualityColor });

    // Popup on the rectangle
    const popupHtml = `
      <div class="rect-popup">
        <div class="rp-title">📐 Selected Region</div>
        <div class="rp-row"><span>Size</span><b>${areaSqKm} km²</b></div>
        <div class="rp-row"><span>Width</span><b>~${kmLng.toFixed(1)} km</b></div>
        <div class="rp-row"><span>Height</span><b>~${kmLat.toFixed(1)} km</b></div>
        <div class="rp-row"><span>Zoom</span><b>Level ${zoom}</b></div>
        <div class="rp-quality rp-${guide.quality}">${guide.icon} ${guide.text}</div>
        <div class="rp-recommend">
          <b>Recommended:</b> Zoom 12–14 · 5–50 km² area<br/>
          for best Sentinel-2 (10m) results
        </div>
      </div>
    `;

    layer.bindPopup(popupHtml, { maxWidth: 260, className: 'rect-popup-wrap' }).openPopup();

    drawnItems.addLayer(layer);
    updatePanel(bounds, areaSqKm, zoom, guide);
    document.getElementById('analyseBtn').disabled = false;

    App.state.bbox = {
      north: bounds.getNorth(),
      south: bounds.getSouth(),
      east:  bounds.getEast(),
      west:  bounds.getWest()
    };
  });

  mapInst.on(L.Draw.Event.DELETED, () => {
    resetPanel();
    document.getElementById('analyseBtn').disabled = true;
  });

  // ── Layer switcher ─────────────────────────────────────────────────────────
  document.querySelectorAll('.ls-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ls-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      switchLayer(btn.dataset.layer);
    });
  });

  document.getElementById('mapHint').textContent =
    'Draw a rectangle on the map over any region — forest, city, coast, river, farmland — to detect changes';

  document.getElementById('analyseBtn').textContent = 'Analyse Changes';

  console.log('[Map] Initialised — general change detection mode');
}

// ── Layer switcher ───────────────────────────────────────────────────────────
function switchLayer(name) {
  if (!mapInst || currentBaseLayer === name) return;
  mapInst.removeLayer(TILE_LAYERS.satellite);
  mapInst.removeLayer(TILE_LAYERS.street);
  if (labelsLayer) mapInst.removeLayer(labelsLayer);

  if (name === 'satellite') {
    TILE_LAYERS.satellite.addTo(mapInst);
    TILE_LAYERS.satelliteLabels.addTo(mapInst);
    labelsLayer = TILE_LAYERS.satelliteLabels;
  } else {
    TILE_LAYERS.street.addTo(mapInst);
    labelsLayer = null;
  }
  currentBaseLayer = name;
}

// ── Side panel update ────────────────────────────────────────────────────────
function updatePanel(bounds, areaSqKm, zoom, guide) {
  const nw = bounds.getNorthWest();
  const se = bounds.getSouthEast();

  document.getElementById('coordNW').textContent = `${nw.lat.toFixed(4)}°, ${nw.lng.toFixed(4)}°`;
  document.getElementById('coordSE').textContent = `${se.lat.toFixed(4)}°, ${se.lng.toFixed(4)}°`;
  document.getElementById('areaKm').textContent  = `${areaSqKm} km²`;

  // Update hint
  const hint = document.getElementById('mapHint');
  hint.textContent = `✓ Region selected (${areaSqKm} km²) — set dates and click Analyse Changes`;

  // Quality warnings
  const area = parseFloat(areaSqKm);
  if (guide.quality === 'too-close') {
    App.toast('Area too small — zoom out and draw a larger box for meaningful results', 'warn');
  } else if (guide.quality === 'too-wide') {
    App.toast('Zoom in more before drawing — current area is very large', 'warn');
  } else if (area > 500) {
    App.toast('Large area selected — analysis may take longer and show less detail', 'warn');
  }
}

function resetPanel() {
  ['coordNW', 'coordSE', 'areaKm'].forEach(id => {
    document.getElementById(id).textContent = '—';
  });
  App.state.bbox = null;
  document.getElementById('mapHint').textContent =
    'Draw a rectangle on the map over any region to detect changes';
}

// ── Analyse button ───────────────────────────────────────────────────────────
document.getElementById('analyseBtn').addEventListener('click', () => {
  const from = document.getElementById('dateFrom').value;
  const to   = document.getElementById('dateTo').value;

  if (!App.state.bbox) {
    return App.toast('Please draw a rectangle on the map first', 'warn');
  }
  if (!from || !to) {
    return App.toast('Please select a date range', 'warn');
  }
  if (new Date(from) >= new Date(to)) {
    return App.toast('"From" date must be before "To" date', 'warn');
  }

  App.state.dateFrom = from;
  App.state.dateTo   = to;

  App.goTo('analysis');
  window.dispatchEvent(new Event('startAnalysis'));
});

window.addEventListener('mapInit', initMap);

window.addEventListener('screenChange', e => {
  if (e.detail === 'map' && mapInst) {
    setTimeout(() => mapInst.invalidateSize(), 100);
  }
});