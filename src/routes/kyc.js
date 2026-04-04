const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { verifyKYC } = require('../controllers/kycController');

// POST /api/kyc/verify
// Protected: user must be logged in, but PENDING walled-garden users are also allowed
router.post('/verify', protect, verifyKYC);

module.exports = router;
