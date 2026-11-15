const Groq  = require('groq-sdk');
const axios = require('axios');

let groq;
function getGroq() {
  if (!groq) {
    if (!process.env.GROQ_API_KEY || process.env.GROQ_API_KEY === 'your_groq_api_key_here') {
      throw new Error('GROQ_API_KEY not set. Get a free key at https://console.groq.com/keys');
    }
    groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return groq;
}

// Convert image URL to base64 data URI
async function urlToBase64(url) {
  try {
    const res = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 45000,
      headers: {
        'User-Agent': 'Mozilla/5.0 TerraVision/1.0',
        'Accept':     'image/jpeg,image/png,image/*'
      }
    });
    const mime = res.headers['content-type']?.split(';')[0] || 'image/jpeg';
    const b64  = Buffer.from(res.data).toString('base64');
    if (b64.length < 100) return null;
    return 'data:' + mime + ';base64,' + b64;
  } catch (e) {
    console.warn('[AnalysisService] urlToBase64 failed:', e.message);
    return null;
  }
}

async function compareImages({ beforeImage, afterImage, bbox, dateFrom, dateTo }) {
  const client = getGroq();

  const beforeB64 = beforeImage.base64 || await urlToBase64(beforeImage.url);
  const afterB64  = afterImage.base64  || await urlToBase64(afterImage.url);

  const hasImages = !!(beforeB64 && afterB64);
  console.log('[AnalysisService] Images loaded:', hasImages, '| Calling Groq...');

  let rawResponse;

  if (hasImages) {
    try {
      const visionPrompt = buildVisionPrompt(beforeImage, afterImage, bbox, dateFrom, dateTo);
      const completion   = await client.chat.completions.create({
        model:       'meta-llama/llama-4-scout-17b-16e-instruct',
        max_tokens:  2000,
        temperature: 0.1,
        messages: [{
          role:    'user',
          content: [
            { type: 'text',      text:      visionPrompt },
            { type: 'image_url', image_url: { url: beforeB64, detail: 'high' } },
            { type: 'image_url', image_url: { url: afterB64,  detail: 'high' } }
          ]
        }]
      });
      rawResponse = completion.choices[0]?.message?.content || '';
      console.log('[AnalysisService] Vision model (Llama 4 Scout) succeeded');
    } catch (visionErr) {
      console.warn('[AnalysisService] Vision model error, falling back:', visionErr.message);
      rawResponse = await callTextFallback(client, beforeImage, afterImage, bbox, dateFrom, dateTo);
    }
  } else {
    console.warn('[AnalysisService] No images available, using geo-based text analysis');
    rawResponse = await callTextFallback(client, beforeImage, afterImage, bbox, dateFrom, dateTo);
  }

  const parsed = parseResponse(rawResponse);

  return {
    ...parsed,
    rawResponse,
    hasImages,
    beforeDate: beforeImage.date,
    afterDate:  afterImage.date
  };
}

// ─── Vision model prompt — fully general, no infrastructure bias ──────────────
function buildVisionPrompt(beforeImage, afterImage, bbox, dateFrom, dateTo) {
  const lat      = ((bbox.north + bbox.south) / 2).toFixed(4);
  const lon      = ((bbox.east  + bbox.west)  / 2).toFixed(4);
  const yearSpan = new Date(dateTo).getFullYear() - new Date(dateFrom).getFullYear();
  const source   = (beforeImage.source || '').toLowerCase();
  const isMODIS  = source.includes('modis') || source.includes('250m');

  const resNote = isMODIS
    ? 'NOTE: These are MODIS 250m resolution images. Individual buildings and roads cannot be seen. ' +
      'Assess only large-scale patterns: forests, agricultural land, water bodies larger than 1 km², ' +
      'bare soil extents, and major land cover transitions. Do NOT claim to see individual structures.'
    : 'These are Sentinel-2 10m resolution images. Individual fields, farm plots, roads, rivers, ' +
      'building clusters, and coastline details are visible. Report what you actually see.';

  const beforeLabel  = beforeImage.date   || dateFrom;
  const afterLabel   = afterImage.date    || dateTo;
  const sourceBefore = beforeImage.source || 'Satellite';
  const sourceAfter  = afterImage.source  || 'Satellite';

  return [
    'You are an expert satellite imagery analyst specialising in multi-temporal land cover change detection.',
    'Your job is to identify ANY and ALL types of change between two images — not just one category.',
    'Report exactly what you see. Do not bias toward any one type of change.',
    '',
    'IMAGE METADATA:',
    '- IMAGE 1 (BEFORE): ' + beforeLabel + ' | Source: ' + sourceBefore,
    '- IMAGE 2 (AFTER):  ' + afterLabel  + ' | Source: ' + sourceAfter,
    '- LOCATION: ' + lat + ' N, ' + lon + ' E',
    '- TIME SPAN: approximately ' + yearSpan + ' year(s)',
    '- ' + resNote,
    '',
    'ANALYSIS APPROACH — follow these steps in order:',
    '1. DESCRIBE IMAGE 1 (BEFORE): What do you see? List dominant land cover types,',
    '   colours, textures, patterns. Be specific about what occupies each part of the image.',
    '2. DESCRIBE IMAGE 2 (AFTER): Same process. What is the same? What looks different?',
    '3. COMPARE: Identify every visible change. Consider ALL possible change types:',
    '   - Vegetation: growth, loss, browning, seasonal shift, deforestation, afforestation',
    '   - Water: lake/river expansion or shrinkage, flooding, drought, new reservoirs',
    '   - Urban/Built: new buildings, roads, expansion of settlements, demolition',
    '   - Agriculture: new farmland, abandoned fields, crop pattern changes',
    '   - Soil/Bare land: erosion, land clearing, mining, landslides',
    '   - Coastal: shoreline change, erosion, land reclamation',
    '   - Snow/Ice: glacier retreat, snowpack change',
    '   - Fire: burn scars, post-fire recovery',
    '   Report ONLY changes that are actually visible in both images.',
    '4. QUANTIFY: Estimate what percentage of the total image area shows change.',
    '5. HONEST LIMITS: If images appear very similar, or clouds block >30% of either image, say so.',
    '   "No significant change detected" is a valid and correct finding.',
    '',
    'COLOUR INTERPRETATION GUIDE for true-colour satellite imagery:',
    '- Dark green / bright green = dense vegetation, forest, healthy crops',
    '- Light green / yellow-green = sparse vegetation, grassland, stressed crops',
    '- Brown / tan = bare soil, deforested land, dry areas, desert',
    '- Dark blue / near-black = deep water bodies',
    '- Light blue / cyan = shallow water, wetlands, rivers',
    '- Grey / white patches with hard edges = urban areas, buildings, roads, concrete',
    '- White / bright = clouds, snow, salt flats, sand',
    '- Black = shadow or no-data areas',
    '',
    'DYNAMIC METRICS RULE: In the metrics object, only include keys for what you actually found.',
    'If there is no water in the images, omit waterBodyChange.',
    'If there is no urban area, omit urbanExpansion.',
    'Only report metrics that are relevant to what is actually visible.',
    '',
    'CRITICAL OUTPUT RULE: Respond with ONLY a single valid JSON object.',
    'No markdown code fences. No backticks. No text before or after the JSON.',
    'Start your response with { and end it with }.',
    '',
    'Required JSON structure:',
    '{',
    '  "summary": "2-3 sentence factual summary of the most important changes observed, based strictly on visual evidence.",',
    '  "severity": "LOW",',
    '  "changes": [',
    '    {',
    '      "category": "Vegetation",',
    '      "description": "Specific description: what changed, where in the image, estimated area or percentage affected.",',
    '      "significance": "HIGH"',
    '    }',
    '  ],',
    '  "metrics": {',
    '    "vegetationChange": "describe only if vegetation change is visible",',
    '    "waterBodyChange": "describe only if water change is visible",',
    '    "urbanExpansion": "describe only if urban change is visible",',
    '    "bareSoilChange": "describe only if bare soil change is visible"',
    '  },',
    '  "environmental": "2-3 sentences on the ecological, environmental or human significance of the detected changes.",',
    '  "detailed": "One continuous paragraph: describe IMAGE 1 in detail, then IMAGE 2 in detail, then all differences found, then confidence notes about image quality and cloud cover."',
    '}',
    '',
    'Allowed severity values: LOW, MODERATE, HIGH, CRITICAL.',
    'Allowed category values: Vegetation, Forest, Urban, Agriculture, Water, Soil, Coastal, Glacier, Fire, Infrastructure, Cloud, Other.',
    'Allowed significance values: LOW, MODERATE, HIGH.',
    'The detailed field must be ONE continuous paragraph with no embedded newlines.',
    'The metrics object should only contain keys relevant to what was actually observed in the images.',
  ].join('\n');
}

// ─── Text fallback — geo-context based, no imagery ───────────────────────────
async function callTextFallback(client, beforeImage, afterImage, bbox, dateFrom, dateTo) {
  const lat           = ((bbox.north + bbox.south) / 2).toFixed(4);
  const lon           = ((bbox.east  + bbox.west)  / 2).toFixed(4);
  const regionContext = inferRegionType(lat, lon, bbox);

  const lines = [
    'You are a satellite imagery analyst. Satellite images for this area could not be loaded.',
    'Perform a geographic and temporal analysis based on coordinates and known regional patterns.',
    '',
    'LOCATION: ' + lat + ' N, ' + lon + ' E (' + regionContext.description + ')',
    'BEFORE DATE: ' + (beforeImage.date || dateFrom),
    'AFTER DATE: '  + (afterImage.date  || dateTo),
    'REGION TYPE: ' + regionContext.type,
    'KNOWN PATTERNS: ' + regionContext.patterns,
    '',
    'Satellite images were unavailable. Be honest about this.',
    'Base your response on known geographic and environmental trends for this region type.',
    'Do NOT invent specific measurements. Use phrases like "likely", "typically", "expected".',
    '',
    'CRITICAL OUTPUT RULE: Respond with ONLY a single valid JSON object.',
    'No markdown code fences. No backticks. No text before or after the JSON.',
    'Start your response with { and end it with }.',
    '',
    '{',
    '  "summary": "Satellite images could not be loaded for this region. Geographic context analysis only — not based on actual imagery.",',
    '  "severity": "LOW",',
    '  "changes": [{"category": "Other", "description": "No satellite imagery was available. The following is a geographic estimate based on known patterns for this region type. For real analysis, ensure GEE is running or try a different date range.", "significance": "LOW"}],',
    '  "metrics": {"dataAvailability": "No imagery loaded — geo-context estimate only"},',
    '  "environmental": "' + regionContext.detailedContext + '",',
    '  "detailed": "No actual satellite imagery was analysed for this location (' + lat + ' N, ' + lon + ' E). This is a ' + regionContext.type + ' region. ' + regionContext.detailedContext + ' Time period: ' + dateFrom + ' to ' + dateTo + '. Imagery could not be retrieved — check GEE server status or try a different area and date range."',
    '}',
  ];

  const completion = await client.chat.completions.create({
    model:       'llama-3.3-70b-versatile',
    max_tokens:  1200,
    temperature: 0.1,
    messages: [{ role: 'user', content: lines.join('\n') }]
  });

  return completion.choices[0]?.message?.content || '';
}

// ─── Region inference ────────────────────────────────────────────────────────
function inferRegionType(lat, lon, bbox) {
  const fLat = parseFloat(lat);
  const fLon = parseFloat(lon);

  let type            = 'temperate';
  let description     = 'Temperate region';
  let patterns        = 'Mixed land use, seasonal vegetation changes';
  let detailedContext = 'This temperate region typically shows seasonal vegetation cycles and gradual urban or agricultural change over multi-year periods.';

  if (fLat > 60) {
    type            = 'arctic';
    description     = 'Arctic/subarctic region at ' + lat + ' N';
    patterns        = 'Permafrost, tundra, ice and snow changes';
    detailedContext = 'Arctic regions may show permafrost thaw, shrub encroachment, reduced sea ice, and changes in snow cover extent over multi-year periods.';
  } else if (fLat > 40) {
    type            = 'temperate';
    description     = 'Temperate region at ' + lat + ' N, ' + lon + ' E';
    patterns        = 'Agriculture, temperate forests, urban areas';
    detailedContext = 'Temperate regions commonly show urban expansion, agricultural land use transitions, and forest disturbance or regrowth over 5-year periods.';
  } else if (fLat > 23) {
    type            = 'subtropical';
    description     = 'Subtropical region at ' + lat + ' N, ' + lon + ' E';
    patterns        = 'Mixed forest, agriculture, coastal development';
    detailedContext = 'Subtropical regions may show agricultural intensification, coastal development, seasonal drought effects, and urban sprawl.';
  } else if (fLat > 0) {
    type            = 'tropical';
    description     = 'Tropical region at ' + lat + ' N, ' + lon + ' E';
    patterns        = 'Rainforest, deforestation risk, agriculture expansion';
    detailedContext = 'Tropical regions commonly experience deforestation, agricultural expansion into forested areas, and rapid urban growth. Forest cover loss is measurable over 3–5 year periods.';
  } else if (fLat > -23) {
    type            = 'tropical-southern';
    description     = 'Southern tropical region at ' + Math.abs(fLat).toFixed(4) + ' S, ' + lon + ' E';
    patterns        = 'Tropical vegetation, deforestation risk, agriculture';
    detailedContext = 'Southern tropical regions show patterns similar to northern tropics — deforestation, cropland expansion, and urban growth are common change drivers.';
  } else {
    type            = 'temperate-southern';
    description     = 'Southern temperate region at ' + Math.abs(fLat).toFixed(4) + ' S, ' + lon + ' E';
    patterns        = 'Agriculture, grasslands, temperate forests';
    detailedContext = 'Southern temperate regions show agricultural land use change, grassland conversion, and moderate urban growth over multi-year periods.';
  }

  // Arid zone override
  if (
    (fLon > 30  && fLon < 60  && fLat > 15 && fLat < 35) ||
    (fLon > -120 && fLon < -100 && fLat > 20 && fLat < 35)
  ) {
    type            = 'arid';
    description     = 'Arid/semi-arid region at ' + lat + ' N, ' + lon + ' E';
    patterns        = 'Desert, sparse vegetation, water body sensitivity';
    detailedContext = 'Arid regions are highly sensitive to water availability. Changes in oasis extents, irrigation areas, wadi (dry riverbed) activity, and sparse scrub vegetation are typical change indicators.';
  }

  return { type, description, patterns, detailedContext };
}

// ─── Response parser ─────────────────────────────────────────────────────────
function parseResponse(raw) {
  if (!raw) return buildFallbackResult('Empty response from AI model.');

  let clean = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/gi, '')
    .trim();

  const start = clean.indexOf('{');
  const end   = clean.lastIndexOf('}');

  if (start === -1 || end === -1 || end <= start) {
    console.warn('[AnalysisService] No JSON object found in response');
    return buildFallbackResult(raw);
  }

  const jsonStr = clean.slice(start, end + 1);

  // Attempt 1: direct parse
  try {
    const p = JSON.parse(jsonStr);
    console.log('[AnalysisService] JSON parsed successfully');
    return extractFields(p, raw);
  } catch (e1) {
    console.warn('[AnalysisService] Direct JSON parse failed:', e1.message);
  }

  // Attempt 2: escape raw newlines
  try {
    const fixed = jsonStr.replace(/("(?:[^"\\]|\\.)*")|(\n)/g, (match, strGroup) => {
      if (strGroup) return strGroup;
      return '\\n';
    });
    const p2 = JSON.parse(fixed);
    console.log('[AnalysisService] JSON parsed after newline escape');
    return extractFields(p2, raw);
  } catch (e2) {
    console.warn('[AnalysisService] Newline-escaped JSON parse failed:', e2.message);
  }

  // Attempt 3: manual extraction
  console.warn('[AnalysisService] Falling back to manual field extraction');
  return extractFieldsManually(clean, raw);
}

function extractFields(p, raw) {
  return {
    summary:       typeof p.summary === 'string'                        ? p.summary       : 'Analysis complete.',
    severity:      validateSeverity(p.severity),
    changes:       Array.isArray(p.changes)                             ? p.changes       : [],
    metrics:       (p.metrics && typeof p.metrics === 'object')         ? p.metrics       : {},
    environmental: typeof p.environmental === 'string'                  ? p.environmental : '',
    detailed:      typeof p.detailed === 'string'                       ? p.detailed      : raw
  };
}

function extractFieldsManually(text, raw) {
  const get = (key) => {
    const re = new RegExp('"' + key + '"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"');
    const m  = text.match(re);
    return m ? m[1].replace(/\\n/g, '\n').replace(/\\"/g, '"') : '';
  };
  return {
    summary:       get('summary')       || 'Analysis complete. See raw response.',
    severity:      validateSeverity(get('severity')),
    changes:       [],
    metrics:       {},
    environmental: get('environmental') || '',
    detailed:      get('detailed')      || raw
  };
}

function buildFallbackResult(raw) {
  return {
    summary:       'Analysis complete. See raw response below.',
    severity:      extractSeverity(raw),
    changes:       [],
    metrics:       {},
    environmental: '',
    detailed:      raw
  };
}

function validateSeverity(s) {
  return ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(s) ? s : 'MODERATE';
}

function extractSeverity(t) {
  if (/critical/i.test(t)) return 'CRITICAL';
  if (/\bhigh\b/i.test(t)) return 'HIGH';
  if (/moderate/i.test(t)) return 'MODERATE';
  return 'LOW';
}

module.exports = { compareImages };