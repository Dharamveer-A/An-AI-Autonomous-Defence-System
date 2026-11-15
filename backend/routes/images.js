const express = require('express');
const router = express.Router();
const imageService = require('../services/imageService');

/**
 * POST /api/images/fetch
 * Body: { bbox: {north, south, east, west}, dateFrom, dateTo }
 * Returns: { before: { url, date }, after: { url, date } }
 */
router.post('/fetch', async (req, res) => {
  try {
    const { bbox, dateFrom, dateTo } = req.body;

    if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
      return res.status(400).json({ error: 'bbox (north/south/east/west) is required' });
    }

    if (!dateFrom || !dateTo) {
      return res.status(400).json({ error: 'dateFrom and dateTo are required' });
    }

    console.log(`[Images] Fetching for bbox:`, bbox, `| ${dateFrom} → ${dateTo}`);

    const images = await imageService.fetchSatelliteImages(bbox, dateFrom, dateTo);

    res.json({ success: true, ...images });
  } catch (err) {
    console.error('[Images] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to fetch satellite images' });
  }
});

module.exports = router;
