/**
 * Moderation Routes — Trust & Safety Engine
 * POST /api/moderation/report        — file a report against a user
 * GET  /api/moderation/my-status     — check if current user is shadow-banned
 */
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User   = require('../models/User');
const Report = require('../models/Report');

// ── POST /api/moderation/report ────────────────────────────────────────────
router.post('/report', protect, async (req, res) => {
  try {
    const { reportedUserId, reason, notes, sessionId } = req.body;

    if (!reportedUserId || !reason) {
      return res.status(400).json({ message: 'reportedUserId and reason are required' });
    }

    if (String(reportedUserId) === String(req.user._id)) {
      return res.status(400).json({ message: 'You cannot report yourself' });
    }

    const VALID_REASONS = ['HARASSMENT', 'NSFW', 'SPAM', 'OFF_TOPIC'];
    if (!VALID_REASONS.includes(reason)) {
      return res.status(400).json({ message: `reason must be one of: ${VALID_REASONS.join(', ')}` });
    }

    // Create the report (unique constraint prevents duplicate per session)
    const report = await Report.create({
      reporterId:     req.user._id,
      reportedUserId,
      reason,
      notes:     notes?.trim()?.slice(0, 1000) || '',
      sessionId: sessionId || null,
    });

    // ── Atomically increment strikes & auto-shadowban at >= 3 ──────────────
    const updated = await User.findByIdAndUpdate(
      reportedUserId,
      [
        { $set: { trustStrikes: { $add: ['$trustStrikes', 1] } } },
        { $set: { isShadowBanned: { $gte: ['$trustStrikes', 3] } } },
      ],
      { new: true, select: 'trustStrikes isShadowBanned name' }
    );

    if (!updated) return res.status(404).json({ message: 'Reported user not found' });

    res.status(201).json({
      message: 'Report filed successfully. Thank you for keeping StudyFriend safe.',
      reportId: report._id,
      targetStrikes: updated.trustStrikes,
      targetShadowBanned: updated.isShadowBanned,
    });
  } catch (err) {
    // Duplicate report (unique index violation) — silently accept to avoid leaking info
    if (err.code === 11000) {
      return res.status(200).json({ message: 'Report already filed for this session.' });
    }
    console.error('Report Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/moderation/my-status ─────────────────────────────────────────
router.get('/my-status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('trustStrikes isShadowBanned').lean();
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ trustStrikes: user.trustStrikes || 0, isShadowBanned: user.isShadowBanned || false });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
