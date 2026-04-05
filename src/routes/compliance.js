/**
 * Compliance Routes — GDPR / India DPDP Act
 * GET    /api/compliance/export          — download all personal data as JSON
 * DELETE /api/compliance/delete-account  — permanent right-to-erasure
 */
const router = require('express').Router();
const { protect } = require('../middleware/auth');
const User         = require('../models/User');
const Contract     = require('../models/Contract');
const Session      = require('../models/Session');
const Message      = require('../models/Message');
const Notification = require('../models/Notification');
const Report       = require('../models/Report');

// ── GET /api/compliance/export ─────────────────────────────────────────────
router.get('/export', protect, async (req, res) => {
  try {
    const uid = req.user._id;

    const [profile, contracts, sessions, messages, reports] = await Promise.all([
      User.findById(uid)
        .select('-password -resetPasswordToken -resetPasswordExpire')
        .lean(),
      Contract.find({ $or: [{ userA: uid }, { userB: uid }] }).lean(),
      Session.find({ $or: [{ host: uid }, { participants: uid }] })
        .select('title subject status scheduledAt duration createdAt')
        .lean(),
      Message.find({ $or: [{ sender: uid }, { receiver: uid }] })
        .select('content createdAt sender receiver')
        .lean(),
      Report.find({ reporterId: uid })
        .select('reason notes status createdAt')
        .lean(),
    ]);

    const exportPayload = {
      exportedAt:   new Date().toISOString(),
      platform:     'StudyFriend (studyfriend.co.in)',
      dataVersion:  '1.0',
      legalBasis:   'GDPR Article 20 / India DPDP Act 2023 Section 11 — Right to Data Portability',
      profile,
      contracts,
      sessions,
      messages,
      reportsFiledByYou: reports,
    };

    const json = JSON.stringify(exportPayload, null, 2);
    const safeName = (profile?.name || 'user').replace(/[^a-z0-9]/gi, '_');

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="studyfriend_data_export_${safeName}.json"`);
    res.setHeader('Content-Length', Buffer.byteLength(json));
    res.status(200).send(json);
  } catch (err) {
    console.error('Data Export Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── DELETE /api/compliance/delete-account ─────────────────────────────────
router.delete('/delete-account', protect, async (req, res) => {
  try {
    const uid = req.user._id;

    // Wipe all associated data in parallel
    await Promise.all([
      User.findByIdAndDelete(uid),
      Contract.deleteMany({ $or: [{ userA: uid }, { userB: uid }] }),
      Session.deleteMany({ $or: [{ host: uid }, { participants: uid }] }),
      Message.deleteMany({ $or: [{ sender: uid }, { receiver: uid }] }),
      Notification.deleteMany({ userId: uid }),
      Report.deleteMany({ $or: [{ reporterId: uid }, { reportedUserId: uid }] }),
    ]);

    // Clear auth cookie (JWT cookie if used)
    res.clearCookie('token', { httpOnly: true, sameSite: 'strict' });

    res.status(200).json({
      message: 'Your account and all associated data have been permanently deleted. Goodbye.',
    });
  } catch (err) {
    console.error('Account Deletion Error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
