/**
 * TerraVision — Image Service
 *
 * Source waterfall (best to fallback):
 *  1. GEE Python microservice            (Sentinel-2, 10m, requires local gee_server.py) ← NOW FIRST
 *  2. Microsoft Planetary Computer STAC  (Sentinel-2, 10m, free, no key)
 *  3. Copernicus Data Space WMS          (Sentinel-2, free, no key)
 *  4. NASA GIBS MODIS                    (250m, always works, no key)
 */

const axios = require('axios');

const GEE_URL = process.env.GEE_PYTHON_SERVICE_URL || 'http://localhost:5001';

async function fetchSatelliteImages(bbox, dateFrom, dateTo) {

  // ── 1. GEE Python microservice (Sentinel-2, 10m) ─────────────────────────────
  try {
    console.log('[ImageService] Trying GEE microservice...');
    const result = await fetchFromGEE(bbox, dateFrom, dateTo);
    if (result) {
      console.log('[ImageService] GEE microservice succeeded');
      return result;
    }
  } catch (e) {
    console.warn('[ImageService] GEE microservice failed:', e.message);
  }

  // ── 2. Microsoft Planetary Computer (Sentinel-2, free, no key) ──────────────
  try {
    console.log('[ImageService] Trying Planetary Computer STAC...');
    const result = await fetchPlanetaryComputer(bbox, dateFrom, dateTo);
    if (result) {
      console.log('[ImageService] Planetary Computer succeeded');
      return result;
    }
  } catch (e) {
    console.warn('[ImageService] Planetary Computer failed:', e.message);
  }

  // ── 3. Copernicus Data Space WMS (Sentinel-2 true-colour, free) ─────────────
  try {
    console.log('[ImageService] Trying Copernicus Data Space WMS...');
    const result = await fetchCopernicusWMS(bbox, dateFrom, dateTo);
    if (result) {
      console.log('[ImageService] Copernicus WMS succeeded');
      return result;
    }
  } catch (e) {
    console.warn('[ImageService] Copernicus WMS failed:', e.message);
  }

  // ── 4. NASA GIBS MODIS (always works, 250m) ──────────────────────────────────
  console.log('[ImageService] Falling back to NASA GIBS MODIS (250m)');
  return buildNasaGibsImages(bbox, dateFrom, dateTo);
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 1: GEE Python Microservice
// Calls the local Flask server running gee_server.py on port 5001.
// Returns Sentinel-2 SR images at 10m resolution.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFromGEE(bbox, dateFrom, dateTo) {
  // First check if GEE server is up
  const health = await axios.get(GEE_URL + '/health', { timeout: 5000 });
  if (!health.data?.gee_ready) {
    console.warn('[GEE] Server is up but GEE is not ready');
    return null;
  }

  const res = await axios.post(GEE_URL + '/get-images', {
    bbox,
    dateFrom,
    dateTo
  }, { timeout: 60000 }); // GEE can take time, give it 60 seconds

  const { before, after } = res.data;

  if (!before?.url || !after?.url) {
    console.warn('[GEE] Response missing before/after URLs');
    return null;
  }

  // Verify the URLs return real images
  const [bOk, aOk] = await Promise.all([
    checkImageUrl(before.url),
    checkImageUrl(after.url)
  ]);

  if (!bOk || !aOk) {
    console.warn('[GEE] One or both image URLs did not return valid images');
    return null;
  }

  return {
    before: {
      url:    before.url,
      date:   before.date,
      source: 'Google Earth Engine · ' + (before.source || 'Sentinel-2 SR') + ' (10m)'
    },
    after: {
      url:    after.url,
      date:   after.date,
      source: 'Google Earth Engine · ' + (after.source || 'Sentinel-2 SR') + ' (10m)'
    },
    source: 'Google Earth Engine · Sentinel-2 SR Harmonized (10m resolution)'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 2: Microsoft Planetary Computer
// Queries STAC for lowest-cloud Sentinel-2 L2A scene and returns the
// rendered_preview JPEG (true-colour), signed for public access.
// ─────────────────────────────────────────────────────────────────────────────
async function fetchPlanetaryComputer(bbox, dateFrom, dateTo) {
  const { north, south, east, west } = bbox;
  const bboxArr = [west, south, east, north];

  const t0  = new Date(dateFrom);
  const t1  = new Date(dateTo);
  const mid = new Date((t0.getTime() + t1.getTime()) / 2);

  const beforeWindow = fmt(t0) + '/' + fmt(addDays(mid, -1));
  const afterWindow  = fmt(addDays(mid, 1)) + '/' + fmt(t1);

  const STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1/search';

  async function bestScene(window) {
    const body = {
      collections: ['sentinel-2-l2a'],
      bbox: bboxArr,
      datetime: window,
      limit: 10,
      sortby: [{ field: 'properties.eo:cloud_cover', direction: 'asc' }],
      fields: {
        include: ['id', 'properties.datetime', 'properties.eo:cloud_cover', 'assets.rendered_preview']
      }
    };

    const res = await axios.post(STAC, body, {
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      timeout: 25000
    });

    const features = res.data?.features || [];
    if (!features.length) {
      console.warn('[PC] No scenes found for window:', window);
      return null;
    }

    const best  = features[0];
    const cloud = best.properties?.['eo:cloud_cover'];
    if (cloud !== undefined && cloud > 80) {
      console.warn('[PC] Best scene has ' + cloud + '% cloud — rejecting');
      return null;
    }

    const previewHref = best.assets?.rendered_preview?.href;
    if (!previewHref) {
      console.warn('[PC] No rendered_preview asset found');
      return null;
    }

    let finalUrl = previewHref;
    try {
      finalUrl = await signPlanetaryComputerUrl(previewHref);
    } catch {
      console.warn('[PC] Signing failed, using unsigned URL');
    }

    const ok = await checkImageUrl(finalUrl);
    if (!ok) {
      console.warn('[PC] Preview URL did not return a valid image');
      return null;
    }

    return {
      url:    finalUrl,
      date:   (best.properties?.datetime || '').slice(0, 10),
      source: 'Planetary Computer · Sentinel-2 L2A' + (cloud !== undefined ? ' (' + Math.round(cloud) + '% cloud)' : '')
    };
  }

  const [before, after] = await Promise.all([
    bestScene(beforeWindow).catch(() => null),
    bestScene(afterWindow).catch(() => null)
  ]);

  if (!before || !after) return null;

  return {
    before,
    after,
    source: 'Microsoft Planetary Computer · Sentinel-2 L2A (10m resolution)'
  };
}

async function signPlanetaryComputerUrl(href) {
  const collection = 'sentinel-2-l2a';
  const tokenRes = await axios.get(
    'https://planetarycomputer.microsoft.com/api/sas/v1/token/' + collection,
    { timeout: 10000 }
  );
  const token = tokenRes.data?.token;
  if (!token) return href;
  return href + '?' + token;
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 3: Copernicus Data Space WMS (Sentinel-2 TRUE-COLOR, free)
// ─────────────────────────────────────────────────────────────────────────────
async function fetchCopernicusWMS(bbox, dateFrom, dateTo) {
  const t0  = new Date(dateFrom);
  const t1  = new Date(dateTo);
  const mid = new Date((t0.getTime() + t1.getTime()) / 2);

  const beforeDate = pickClearDate(t0, mid);
  const afterDate  = pickClearDate(addDays(mid, 1), t1);

  const { paddedNorth, paddedSouth, paddedEast, paddedWest } = padBbox(bbox);
  const bboxStr = paddedWest + ',' + paddedSouth + ',' + paddedEast + ',' + paddedNorth;

  const base   = 'https://sh.dataspace.copernicus.eu/wms/aa17fbfe-8c6c-4eb1-9571-4ba7f71ae96a';
  const common = {
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    CRS: 'EPSG:4326',
    WIDTH: '800', HEIGHT: '800',
    FORMAT: 'image/jpeg',
    BBOX: bboxStr,
    LAYERS: 'TRUE-COLOR',
    MAXCC: '20'
  };

  const beforeUrl = base + '?' + new URLSearchParams(Object.assign({}, common, { TIME: fmt(beforeDate) + '/' + fmt(beforeDate) }));
  const afterUrl  = base + '?' + new URLSearchParams(Object.assign({}, common, { TIME: fmt(afterDate)  + '/' + fmt(afterDate)  }));

  const [bOk, aOk] = await Promise.all([checkImageContent(beforeUrl), checkImageContent(afterUrl)]);
  if (!bOk || !aOk) {
    console.warn('[Copernicus] One or both image URLs returned non-image content');
    return null;
  }

  console.log('[Copernicus] before=' + fmt(beforeDate) + ', after=' + fmt(afterDate));
  return {
    before: { url: beforeUrl, date: fmt(beforeDate), source: 'Copernicus Data Space · Sentinel-2' },
    after:  { url: afterUrl,  date: fmt(afterDate),  source: 'Copernicus Data Space · Sentinel-2' },
    source: 'Copernicus Data Space · Sentinel-2 (10m resolution)'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCE 4: NASA GIBS MODIS (250m — last resort, always works)
// ─────────────────────────────────────────────────────────────────────────────
function buildNasaGibsImages(bbox, dateFrom, dateTo) {
  const t0  = new Date(dateFrom);
  const t1  = new Date(dateTo);
  const mid = new Date((t0.getTime() + t1.getTime()) / 2);

  const beforeDate = pickClearDate(t0, mid);
  const afterDate  = pickClearDate(addDays(mid, 1), t1);

  const { paddedNorth, paddedSouth, paddedEast, paddedWest } = padBbox(bbox, 0.5);
  const bboxStr = paddedSouth + ',' + paddedWest + ',' + paddedNorth + ',' + paddedEast;

  const gibsBase = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi';
  const common   = {
    SERVICE: 'WMS', VERSION: '1.3.0', REQUEST: 'GetMap',
    CRS: 'EPSG:4326', WIDTH: '800', HEIGHT: '800',
    FORMAT: 'image/jpeg', BBOX: bboxStr,
    LAYERS: 'MODIS_Terra_CorrectedReflectance_TrueColor'
  };

  const beforeUrl = gibsBase + '?' + new URLSearchParams(Object.assign({}, common, { TIME: fmt(beforeDate) }));
  const afterUrl  = gibsBase + '?' + new URLSearchParams(Object.assign({}, common, { TIME: fmt(afterDate)  }));

  console.log('[GIBS] before=' + fmt(beforeDate) + ', after=' + fmt(afterDate) + ' | bbox N=' + paddedNorth.toFixed(3) + ' S=' + paddedSouth.toFixed(3));
  return {
    before: { url: beforeUrl, date: fmt(beforeDate), source: 'NASA GIBS · MODIS Terra 250m' },
    after:  { url: afterUrl,  date: fmt(afterDate),  source: 'NASA GIBS · MODIS Terra 250m' },
    source: 'NASA GIBS / MODIS Terra (250m resolution)'
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function padBbox(bbox, minSpan) {
  minSpan = minSpan || 0.25;
  const { north, south, east, west } = bbox;
  const latSpan = north - south;
  const lonSpan = east  - west;
  const latPad  = latSpan < minSpan ? (minSpan - latSpan) / 2 : latSpan * 0.05;
  const lonPad  = lonSpan < minSpan ? (minSpan - lonSpan) / 2 : lonSpan * 0.05;
  return {
    paddedNorth: Math.min( 90,  north + latPad),
    paddedSouth: Math.max(-90,  south - latPad),
    paddedEast:  Math.min( 180, east  + lonPad),
    paddedWest:  Math.max(-180, west  - lonPad)
  };
}

function pickClearDate(start, end) {
  if (start >= end) return start;
  const mid  = new Date((start.getTime() + end.getTime()) / 2);
  const year = mid.getFullYear();
  for (const d of [
    new Date(year + '-07-15'), new Date(year + '-08-15'),
    new Date(year + '-06-15'), new Date(year + '-09-01')
  ]) {
    if (d >= start && d <= end) return d;
  }
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 2);
  return mid > yesterday ? yesterday : mid;
}

async function checkImageUrl(url) {
  try {
    const res = await axios.head(url, { timeout: 10000 });
    const ct  = res.headers['content-type'] || '';
    return res.status === 200 && ct.includes('image/');
  } catch {
    return false;
  }
}

async function checkImageContent(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 15000,
      headers: { Range: 'bytes=0-4095' }
    });
    const ct = res.headers['content-type'] || '';
    if (!ct.includes('image/')) return false;

    const buf = Buffer.from(res.data);
    if (buf.length < 4) return false;

    const isJpeg = buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    const isPng  = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47;

    if (!isJpeg && !isPng) {
      console.warn('[checkImageContent] Non-image bytes returned despite image content-type');
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

const fmt     = d => d.toISOString().split('T')[0];
const addDays = (d, n) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

module.exports = { fetchSatelliteImages };