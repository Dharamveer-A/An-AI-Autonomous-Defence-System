const express = require('express');
const router = express.Router();
const analysisService = require('../services/analysisService');

/**
 * POST /api/analysis/compare
 * Body: {
 *   beforeImage: { url, date, base64? },
 *   afterImage:  { url, date, base64? },
 *   bbox:        { north, south, east, west },
 *   dateFrom:    string,
 *   dateTo:      string
 * }
 * Returns: { summary, changes[], metrics{}, environmental, detailed, severity }
 */
router.post('/compare', async (req, res) => {
  try {
    const { beforeImage, afterImage, bbox, dateFrom, dateTo } = req.body;

    if (!beforeImage || !afterImage) {
      return res.status(400).json({ error: 'beforeImage and afterImage are required' });
    }

    console.log(`[Analysis] Comparing images | ${dateFrom} → ${dateTo}`);

    const result = await analysisService.compareImages({
      beforeImage,
      afterImage,
      bbox,
      dateFrom,
      dateTo
    });

    res.json({ success: true, ...result });
  } catch (err) {
    console.error('[Analysis] Error:', err.message);
    res.status(500).json({ error: err.message || 'Analysis failed' });
  }
});

module.exports = router;
