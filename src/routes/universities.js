const express = require('express');
const router = express.Router();

/**
 * GET /api/universities?search=<term>
 * Server-side proxy for http://universities.hipolabs.com
 * Bypasses browser Mixed-Content (HTTPS → HTTP) block by
 * making the outbound HTTP call from Node.js instead of the browser.
 */
router.get('/', async (req, res) => {
  const search = (req.query.search || '').trim();

  if (!search || search.length < 2) {
    return res.json([]);
  }

  try {
    const url = `http://universities.hipolabs.com/search?country=India&name=${encodeURIComponent(search)}`;
    
    // Use native fetch (Node 18+) or fall back to http module
    const response = await fetch(url, {
      signal: AbortSignal.timeout(8000), // 8s timeout
    });

    if (!response.ok) {
      return res.status(response.status).json({ message: 'Upstream HipoLabs API error' });
    }

    const data = await response.json();

    // Normalise: HipoLabs returns objects with { name, domains, country, ... }
    // Only send back the fields the frontend needs to keep the payload lean.
    const normalised = data.map((u) => ({
      name: u.name,
      domains: u.domains || [],
      country: u.country || 'India',
      web_pages: u.web_pages || [],
    }));

    res.json(normalised);
  } catch (err) {
    console.error('[universities proxy] fetch error:', err.message);
    // Return empty array rather than crashing – frontend gracefully handles it
    res.status(500).json({ message: 'University proxy request failed', error: err.message });
  }
});

module.exports = router;
