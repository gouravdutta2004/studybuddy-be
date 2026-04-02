const express = require('express');
const router = express.Router();
const { getSettings, updateSettings } = require('../controllers/settingsController');
const { protect, admin } = require('../middleware/auth');

router.get('/', protect, getSettings);
router.put('/', protect, admin, updateSettings);

module.exports = router;
