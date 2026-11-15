// TerraVision — General Change Detection Controller

const API_BASE = window.location.origin;

function step(n, state) {
  const el = document.getElementById(`lstep${n}`);
  if (!el) return;
  el.classList.remove('active', 'done');
  if (state) el.classList.add(state);
}

function setLoad(title, sub) {
  document.getElementById('loadingTitle').textContent = title;
  document.getElementById('loadingSubtext').textContent = sub;
}

function showState(id) {
  ['loadingState', 'resultsState', 'errorState'].forEach(s => {
    document.getElementById(s)?.classList.toggle('hidden', s !== id);
  });
}

// ─── Main flow ──────────────────────────────────────────────────────────────
async function runAnalysis() {
  const { bbox, dateFrom, dateTo } = App.state;

  showState('loadingState');
  step(1, 'active'); step(2, ''); step(3, ''); step(4, '');
  setLoad(
    'Fetching Satellite Imagery',
    'Querying satellite archives for your selected region…'
  );

  try {
    // Step 1: Images
    const imgRes = await fetch(`${API_BASE}/api/images/fetch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bbox, dateFrom, dateTo })
    });

    if (!imgRes.ok) {
      throw new Error((await imgRes.json()).error || 'Failed to fetch images');
    }

    const imageData = await imgRes.json();
    step(1, 'done');

    // Step 2: Processing
    step(2, 'active');
    setLoad(
      'Processing Imagery',
      `Source: ${imageData.source || 'Satellite Archive'} · Preparing before & after comparison`
    );
    await sleep(700);
    step(2, 'done');

    // Step 3: AI
    step(3, 'active');
    setLoad(
      'Running AI Change Detection',
      'Vision model scanning for vegetation, urban, water, soil and land cover changes…'
    );

    const aiRes = await fetch(`${API_BASE}/api/analysis/compare`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        beforeImage: imageData.before,
        afterImage:  imageData.after,
        bbox,
        dateFrom,
        dateTo
      })
    });

    if (!aiRes.ok) {
      throw new Error((await aiRes.json()).error || 'Analysis failed');
    }

    const analysisData = await aiRes.json();
    step(3, 'done');

    // Step 4: Render
    step(4, 'active');
    setLoad('Building Report', 'Formatting change detection results…');
    await sleep(400);
    step(4, 'done');

    renderResults(imageData, normalizeData(analysisData));
    showState('resultsState');

  } catch (err) {
    console.error('[Analysis]', err);
    document.getElementById('errorMsg').textContent = err.message;
    showState('errorState');
  }
}

// ─── Normalizer ─────────────────────────────────────────────────────────────
function normalizeData(data = {}) {
  const metrics = data.metrics || {};

  // Build a clean metrics object — show whatever keys come back from AI
  const cleanMetrics = {};
  const metricKeys = [
    'vegetationChange', 'urbanExpansion', 'waterBodyChange', 'bareSoilChange',
    'forestCover', 'agriculturalChange', 'coastalChange', 'glacierChange',
    'infrastructureChange', 'floodExtent', 'droughtImpact'
  ];

  metricKeys.forEach(k => {
    if (metrics[k] !== undefined && metrics[k] !== null && metrics[k] !== '') {
      cleanMetrics[k] = metrics[k];
    }
  });

  // If AI returned other keys not in our list, include those too
  Object.entries(metrics).forEach(([k, v]) => {
    if (!cleanMetrics[k] && v !== undefined && v !== null && v !== '') {
      cleanMetrics[k] = v;
    }
  });

  return {
    ...data,
    summary:       data.summary       || 'Change detection analysis completed for the selected region.',
    environmental: data.environmental || 'See detailed analysis below for ecological and land use context.',
    detailed:      data.detailed      || data.rawResponse || 'No detailed narrative returned.',
    changes:       Array.isArray(data.changes) ? data.changes : [],
    metrics:       cleanMetrics
  };
}

// ─── Render ─────────────────────────────────────────────────────────────────
function renderResults(imageData, data) {
  const { bbox, dateFrom, dateTo } = App.state;

  // Meta bar
  document.getElementById('res-coords').textContent =
    `${bbox.north.toFixed(3)}°N, ${bbox.west.toFixed(3)}°E → ${bbox.south.toFixed(3)}°S, ${bbox.east.toFixed(3)}°E`;
  document.getElementById('res-period').textContent  = `${dateFrom} → ${dateTo}`;
  document.getElementById('res-source').textContent  = imageData.source || 'Satellite';

  const sev   = data.severity || 'MODERATE';
  const sevEl = document.getElementById('res-severity');
  sevEl.textContent = sev;
  sevEl.className   = `sev-pill sev-${sev}`;

  // Images
  loadImg('beforeImg', 'beforeSpinner', 'beforeSrc', imageData.before);
  loadImg('afterImg',  'afterSpinner',  'afterSrc',  imageData.after);

  document.getElementById('beforeDateLabel').textContent =
    `Acquired: ${imageData.before?.date || dateFrom}`;
  document.getElementById('afterDateLabel').textContent =
    `Acquired: ${imageData.after?.date || dateTo}`;

  // Summary
  document.getElementById('summaryText').textContent = data.summary || '—';

  // ── Changes list — fully dynamic, no category filter ──
  const cl = document.getElementById('changesList');
  cl.innerHTML = '';

  const changes = data.changes || [];
  if (!changes.length) {
    cl.innerHTML =
      '<li class="change-li" style="color:var(--text3)">No significant changes detected in this region for the selected period.</li>';
  } else {
    changes.forEach(c => {
      const li = document.createElement('li');
      li.className = `change-li ${c.significance || 'LOW'}`;
      li.innerHTML = `
        <span class="ch-cat">${prettifyKey(c.category || 'Change')}</span>
        <span>${c.description || ''}</span>
      `;
      cl.appendChild(li);
    });
  }

  // ── Metrics — dynamic labels from whatever AI returns ──
  const ml = document.getElementById('metricsList');
  ml.innerHTML = '';

  const metrics = data.metrics || {};
  const visibleMetrics = Object.entries(metrics).filter(([, v]) =>
    v !== undefined && v !== null && v !== '' && v !== 'N/A - no imagery'
  );

  if (!visibleMetrics.length) {
    ml.innerHTML =
      '<div style="color:var(--text3);font-size:12px;padding:8px 0">Quantitative metrics will appear based on the changes detected by the AI.</div>';
  } else {
    visibleMetrics.forEach(([k, v]) => {
      const d = document.createElement('div');
      d.className = 'metric-tile';
      d.innerHTML = `
        <div class="metric-name">${prettifyKey(k)}</div>
        <div class="metric-val">${v || '—'}</div>
      `;
      ml.appendChild(d);
    });
  }

  // Environmental / Ecological impact
  document.getElementById('environmentalText').textContent = data.environmental || '—';

  // Detailed analysis
  document.getElementById('fullAnalysis').textContent =
    data.detailed || data.rawResponse || '—';

  // Raw response
  document.getElementById('rawResponse').textContent = data.rawResponse || '—';

  // Show export
  document.getElementById('exportBtn').classList.remove('hidden');

  // Scroll top
  document.getElementById('analysisBody').scrollTop = 0;
}

// ─── Helpers ────────────────────────────────────────────────────────────────
function prettifyKey(key = '') {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, s => s.toUpperCase());
}

function loadImg(imgId, spinnerId, srcId, imgData) {
  const img     = document.getElementById(imgId);
  const spinner = document.getElementById(spinnerId);
  const srcEl   = document.getElementById(srcId);

  if (!imgData?.url) {
    spinner.classList.add('hidden');
    imgPlaceholder(img, 'Image unavailable for this region/date');
    return;
  }

  srcEl.textContent = imgData.source || 'Satellite';
  spinner.classList.remove('hidden');
  img.style.display = 'none';

  const tempImg    = new Image();
  tempImg.onload   = () => {
    img.src           = imgData.url;
    img.style.display = 'block';
    spinner.classList.add('hidden');
  };
  tempImg.onerror  = () => {
    spinner.classList.add('hidden');
    imgPlaceholder(img, 'Could not load satellite image. Try a different date range or zoom out slightly.');
  };
  tempImg.src = imgData.url;
}

function imgPlaceholder(img, msg) {
  img.style.display = 'none';
  const div         = document.createElement('div');
  div.style.cssText = `
    display:flex; align-items:center; justify-content:center; flex-direction:column;
    width:100%; padding:30px 16px; text-align:center;
    font-size:12px; color:var(--text3); line-height:1.6; gap:8px;
    background:var(--bg2); aspect-ratio:1;
  `;
  div.innerHTML     = `<span style="font-size:24px">🛰️</span><span>${msg}</span>`;
  img.parentNode.appendChild(div);
}

// ─── Controls ───────────────────────────────────────────────────────────────
document.getElementById('toggleRaw')?.addEventListener('click', () => {
  const raw    = document.getElementById('rawResponse');
  const btn    = document.getElementById('toggleRaw');
  const hidden = raw.classList.toggle('hidden');
  btn.innerHTML = hidden
    ? '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 3.5L5.5 7.5L9.5 3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Show Raw AI Response'
    : '<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M1.5 7.5L5.5 3.5L9.5 7.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg> Hide Raw AI Response';
});

document.getElementById('retryBtn')?.addEventListener('click', runAnalysis);
document.getElementById('exportBtn')?.addEventListener('click', () => window.print());
window.addEventListener('startAnalysis', runAnalysis);

const sleep = ms => new Promise(r => setTimeout(r, ms));