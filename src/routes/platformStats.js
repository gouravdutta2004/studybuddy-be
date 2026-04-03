const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Session = require('../models/Session');
const Organization = require('../models/Organization');

router.get('/', async (req, res) => {
  try {
    const userCount = await User.countDocuments();
    
    // Distinct universities (combining user inputs + registered org domains)
    const unis = await User.distinct('university');
    const orgCount = await Organization.countDocuments();
    const uniCount = new Set([...unis.filter(u => !!u)]).size + orgCount;

    // Study Hours (sum of Session duration in minutes / 60)
    const sessions = await Session.aggregate([
      { $match: { status: 'completed' } },
      { $group: { _id: null, totalMinutes: { $sum: "$duration" } } }
    ]);
    const totalHours = sessions.length > 0 ? Math.round(sessions[0].totalMinutes / 60) : 0;

    res.json({
      activeStudents: userCount,
      universities: uniCount,
      matchAccuracy: 98,
      studyHours: totalHours
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching platform stats' });
  }
});

module.exports = router;
