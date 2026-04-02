const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const { getCampusPeers } = require('../controllers/campusController');

// ── WALLED GARDEN APIS ── //
router.get('/peers', protect, getCampusPeers);

module.exports = router;
