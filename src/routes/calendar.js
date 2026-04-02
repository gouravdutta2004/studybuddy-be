const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const Session = require('../models/Session');
const ics = require('ics');

// Generate iCal feed of user's sessions
router.get('/export', protect, async (req, res) => {
  try {
    const sessions = await Session.find({ participants: req.user.id });
    
    if (!sessions || sessions.length === 0) {
      return res.status(404).json({ message: 'No sessions found to export' });
    }

    const events = sessions.map(s => {
      const start = new Date(s.scheduledAt);
      return {
        start: [start.getFullYear(), start.getMonth() + 1, start.getDate(), start.getHours(), start.getMinutes()],
        duration: { hours: Math.floor(s.duration / 60) || 1, minutes: s.duration % 60 || 0 },
        title: s.title,
        description: s.description || 'StudyFriend Session',
        location: s.isOnline ? s.meetingLink : s.location,
        url: s.isOnline ? s.meetingLink : undefined,
        status: 'CONFIRMED'
      };
    });

    ics.createEvents(events, (error, value) => {
      if (error) {
        return res.status(500).json({ message: 'Failed to generate calendar' });
      }
      res.setHeader('Content-Type', 'text/calendar');
      res.setHeader('Content-Disposition', 'attachment; filename="study-sessions.ics"');
      res.send(value);
    });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
