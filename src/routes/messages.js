const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { sendMessage, getConversation, getInbox } = require('../controllers/messageController');

router.get('/inbox', protect, getInbox);
router.get('/:userId', protect, getConversation);
router.post('/', protect, sendMessage);

module.exports = router;
