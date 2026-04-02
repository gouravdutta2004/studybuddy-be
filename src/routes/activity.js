const express = require('express');
const router = express.Router();
const ActivityLog = require('../models/ActivityLog');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// GET /api/activity/global -> Fetch global feed
router.get('/global', protect, async (req, res) => {
  try {
    const logs = await ActivityLog.find()
      .populate('userId', 'name avatar')
      .populate('groupId', 'name avatar')
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(logs);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// GET /api/activity/heatmap/:id -> Fetch user's active days
router.get('/heatmap/:id', protect, async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user.activityLog || []);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// POST /api/activity/log -> Create a global feed log
router.post('/log', protect, async (req, res) => {
  try {
    const { type, description, groupId } = req.body;
    const newLog = await ActivityLog.create({
      type,
      description,
      userId: req.user._id,
      groupId
    });
    res.status(201).json(newLog);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;
