const Rating = require('../models/Rating');
const User = require('../models/User');
const Session = require('../models/Session');

const submitRating = async (req, res) => {
  try {
    const { sessionId, targetUserId, rating, review } = req.body;
    
    // Check if session exists and user was part of it
    const session = await Session.findById(sessionId);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    
    if (!session.participants.map(p => p.toString()).includes(req.user._id.toString()) && session.host.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'You were not a participant in this session' });
    }

    if (!session.participants.map(p => p.toString()).includes(targetUserId) && session.host.toString() !== targetUserId) {
        return res.status(400).json({ message: 'Target user was not in this session' });
    }

    if (req.user._id.toString() === targetUserId) {
        return res.status(400).json({ message: 'Cannot rate yourself' });
    }

    const newRating = await Rating.create({
      session: sessionId,
      reviewer: req.user._id,
      targetUser: targetUserId,
      rating,
      review
    });

    res.status(201).json(newRating);
  } catch (err) {
    if (err.code === 11000) {
        return res.status(400).json({ message: 'You have already rated this user for this session' });
    }
    res.status(500).json({ message: err.message });
  }
};

const getUserRatings = async (req, res) => {
  try {
    const ratings = await Rating.find({ targetUser: req.params.userId })
      .populate('reviewer', 'name avatar')
      .sort({ createdAt: -1 });
    
    // Calculate average
    const avg = ratings.length > 0 
      ? ratings.reduce((acc, curr) => acc + curr.rating, 0) / ratings.length 
      : 0;

    res.json({
        average: avg.toFixed(1),
        count: ratings.length,
        reviews: ratings
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { submitRating, getUserRatings };
