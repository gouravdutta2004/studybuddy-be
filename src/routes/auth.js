const router = require('express').Router();
const { register, login, getMe, forgotPassword, resetPassword, changePassword, googleAuth } = require('../controllers/authController');
const { protect } = require('../middleware/auth');

router.post('/register', register);
router.get('/organizations', require('../controllers/authController').getOrganizations);
router.post('/login', login);
router.post('/google', googleAuth);
router.get('/me', protect, getMe);
router.post('/forgot-password', forgotPassword);
router.put('/reset-password/:token', resetPassword);
router.put('/password', protect, changePassword);

module.exports = router;
