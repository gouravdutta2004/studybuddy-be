const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { submitRating, getUserRatings } = require('../controllers/ratingController');

router.post('/', protect, submitRating);
router.get('/:userId', protect, getUserRatings);

module.exports = router;
