const router = require('express').Router();
const { protect } = require('../middleware/auth');
const { createRoom } = require('../controllers/roomController');

router.get('/live', protect, (req, res) => {
  const liveRooms = req.app.get('liveRooms') || new Map();
  const rooms = Array.from(liveRooms.values());
  res.json(rooms);
});

router.post('/create', protect, createRoom);

module.exports = router;

