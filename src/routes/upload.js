const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { uploadFile } = require('../controllers/uploadController');

router.post('/', protect, uploadFile);

module.exports = router;
