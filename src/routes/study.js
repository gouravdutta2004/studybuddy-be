/**
 * Study Activity Routes — Gamification Engine
 *
 * POST /api/study/submit-activity   — submit a quiz/session result, get XP + level-up
 * GET  /api/study/activity-log/:id  — fetch a user's proof-of-work feed
 * GET  /api/study/skill-mastery     — get current user's skill mastery map
 */
const router = require('express').Router();
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const User         = require('../models/User');
const StudyActivity = require('../models/StudyActivity');

// ── XP Leveling Curve ─────────────────────────────────────────────────────
// XP required to reach each level. Index = level (so LEVEL_CURVE[2] = XP needed for Lvl 2)
const LEVEL_CURVE = [
  0,       // L1  (start)
  1000,    // L2
  2500,    // L3
  4500,    // L4
  7000,    // L5
  10000,   // L6
  14000,   // L7
  19000,   // L8
  25000,   // L9
  32500,   // L10
  42000,   // L11
  54000,   // L12
  68000,   // L13
  85000,   // L14
  105000,  // L15
  130000,  // L16
  160000,  // L17
  195000,  // L18
  235000,  // L19
  280000,  // L20  (Elite cap)
];

function getLevelForXP(xp) {
  let lvl = 1;
  for (let i = 1; i < LEVEL_CURVE.length; i++) {
    if (xp >= LEVEL_CURVE[i]) lvl = i + 1;
    else break;
  }
  return Math.min(lvl, 20);
}

function getXPForNextLevel(level) {
  const nextLvl = Math.min(level + 1, 20);
  return LEVEL_CURVE[nextLvl - 1] ?? LEVEL_CURVE[LEVEL_CURVE.length - 1];
}

// ── POST /api/study/submit-activity ───────────────────────────────────────
router.post('/submit-activity', protect, async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      actionType = 'QUIZ_COMPLETED',
      title,
      subject = 'General',
      score,          // 0–100, null for non-scored activities
      maxScore = 100,
      timeSpent = 0,  // minutes
    } = req.body;

    if (!title) return res.status(400).json({ message: 'title is required' });

    const validTypes = ['QUIZ_COMPLETED', 'HUB_ATTENDED', 'FLASHCARD_SET', 'FOCUS_SESSION'];
    if (!validTypes.includes(actionType)) {
      return res.status(400).json({ message: `actionType must be one of: ${validTypes.join(', ')}` });
    }

    // ── XP Calculation ────────────────────────────────────────────────────
    const BASE_XP = {
      QUIZ_COMPLETED:  200,
      HUB_ATTENDED:    300,
      FLASHCARD_SET:   100,
      FOCUS_SESSION:   150,
    };

    let baseXP = BASE_XP[actionType] ?? 150;

    // Time bonus: +1 XP per minute studied, capped at 200
    baseXP += Math.min(timeSpent, 200);

    // Score multiplier: 90%+ → 1.5×, 70-89% → 1.2×, else 1×
    let multiplier = 1.0;
    if (score !== null && score !== undefined) {
      const pct = (score / maxScore) * 100;
      if (pct >= 90) multiplier = 1.5;
      else if (pct >= 70) multiplier = 1.2;
    }

    const xpEarned = Math.round(baseXP * multiplier);

    // ── User Update ───────────────────────────────────────────────────────
    const user = await User.findById(req.user._id).session(session);
    if (!user) throw new Error('User not found');

    const xpBefore  = user.xp || 0;
    const lvlBefore = user.level || 1;

    // Add XP
    user.xp = xpBefore + xpEarned;

    // Recalculate level
    const lvlAfter   = getLevelForXP(user.xp);
    const didLevelUp = lvlAfter > lvlBefore;
    user.level       = lvlAfter;

    // Study hours
    user.totalStudyHours = (user.totalStudyHours || 0) + (timeSpent / 60);
    user.studyHours      = (user.studyHours || 0)      + (timeSpent / 60);

    // Quizzes passed (any completed quiz or flashcard with score >= 60%)
    if (['QUIZ_COMPLETED', 'FLASHCARD_SET'].includes(actionType)) {
      const pct = score !== null ? (score / maxScore) * 100 : 0;
      if (pct >= 60 || score === null) user.quizzesPassed = (user.quizzesPassed || 0) + 1;
    }

    // ── Skill Mastery Update ──────────────────────────────────────────────
    // Gentle weighted average: 70% existing + 30% new score to avoid wild swings
    if (subject && score !== null) {
      const normalised = Math.round((score / maxScore) * 100);
      const existing   = user.skillMastery?.get(subject) ?? 0;
      const updated    = existing === 0
        ? normalised
        : Math.round(existing * 0.7 + normalised * 0.3);
      if (!user.skillMastery) user.skillMastery = new Map();
      user.skillMastery.set(subject, updated);
      user.markModified('skillMastery'); // Required for Map fields in Mongoose
    }

    // ── Level-Up Badges ───────────────────────────────────────────────────
    if (didLevelUp) {
      const lvlBadge = `Level ${lvlAfter} Scholar`;
      if (!user.badges.includes(lvlBadge)) user.badges.push(lvlBadge);
      if (lvlAfter >= 5  && !user.badges.includes('Rising Star'))   user.badges.push('Rising Star');
      if (lvlAfter >= 10 && !user.badges.includes('Top Scholar'))   user.badges.push('Top Scholar');
      if (lvlAfter >= 20 && !user.badges.includes('Legend'))        user.badges.push('Legend');
    }

    await user.save({ session });

    // ── StudyActivity Log ─────────────────────────────────────────────────
    const [activity] = await StudyActivity.create([{
      userId:     req.user._id,
      actionType,
      title,
      subject,
      score:      score ?? null,
      maxScore,
      timeSpent,
      xpEarned,
      multiplier,
    }], { session });

    await session.commitTransaction();
    session.endSession();

    // ── Response ──────────────────────────────────────────────────────────
    const nextLevelXP = getXPForNextLevel(lvlAfter);
    const currentLevelXP = LEVEL_CURVE[lvlAfter - 1] ?? 0;

    res.status(201).json({
      success: true,
      activity: {
        _id:       activity._id,
        actionType,
        title,
        subject,
        score,
        maxScore,
        xpEarned,
        multiplier,
        timeSpent,
        createdAt: activity.createdAt,
      },
      updatedStats: {
        xp:               user.xp,
        level:            user.level,
        quizzesPassed:    user.quizzesPassed,
        totalStudyHours:  parseFloat(user.totalStudyHours.toFixed(1)),
        skillMastery:     Object.fromEntries(user.skillMastery || new Map()),
        badges:           user.badges,
      },
      progression: {
        xpBefore,
        xpAfter:          user.xp,
        xpGained:         xpEarned,
        multiplier,
        levelBefore:      lvlBefore,
        levelAfter:       lvlAfter,
        didLevelUp,
        currentLevelFloor: currentLevelXP,
        nextLevelXP,
        progressToNext:   Math.min(
          Math.round(((user.xp - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100),
          100
        ),
      },
    });
  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    console.error('submit-activity error:', err.message);
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/study/activity-log/:userId ───────────────────────────────────
router.get('/activity-log/:userId', protect, async (req, res) => {
  try {
    const logs = await StudyActivity.find({ userId: req.params.userId })
      .sort({ createdAt: -1 })
      .limit(30)
      .lean();
    res.json(logs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ── GET /api/study/skill-mastery ──────────────────────────────────────────
router.get('/skill-mastery', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('skillMastery level xp quizzesPassed totalStudyHours')
      .lean();
    res.json({
      skillMastery: user.skillMastery || {},
      level:        user.level,
      xp:           user.xp,
      quizzesPassed: user.quizzesPassed,
      totalStudyHours: user.totalStudyHours,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
