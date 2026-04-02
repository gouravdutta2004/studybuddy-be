const express = require('express');
const router = express.Router();
const User = require('../models/User');
const DailyQuest = require('../models/DailyQuest');
const Bounty = require('../models/Bounty');
const Endorsement = require('../models/Endorsement');
const { protect } = require('../middleware/auth');
const { checkAndCompleteQuest, QUEST_TYPES } = require('../utils/questEngine');

/* ─────────────────────────────────────────────────────
   Shared streak helper — SINGLE SOURCE OF TRUTH
   Returns { streak, changed } and mutates the user doc.
   Uses UTC calendar-day arithmetic to be timezone-safe.
───────────────────────────────────────────────────── */
function applyStreakLogic(user) {
  // UTC midnight of today
  const todayUTC = new Date();
  todayUTC.setUTCHours(0, 0, 0, 0);

  let changed = false;

  if (!user.lastStudyDate) {
    // First-ever activity
    user.streak = 1;
    user.lastStudyDate = new Date();
    changed = true;
  } else {
    const lastUTC = new Date(user.lastStudyDate);
    lastUTC.setUTCHours(0, 0, 0, 0);

    const diffMs = todayUTC - lastUTC;
    const diffDays = Math.round(diffMs / 86_400_000); // ms → days

    if (diffDays === 0) {
      // Already pinged today — streak unchanged, just refresh timestamp
    } else if (diffDays === 1) {
      // Consecutive day ✅
      user.streak = (user.streak || 0) + 1;
      user.lastStudyDate = new Date();
      changed = true;
    } else {
      // Gap > 1 day — streak broken 💔
      user.streak = 1;
      user.lastStudyDate = new Date();
      changed = true;
    }
  }

  // Keep currentStreak in sync (legacy field)
  user.currentStreak = user.streak;

  // Streak-based badges
  if (user.streak >= 7 && !user.badges.includes('7-Day Star'))   user.badges.push('7-Day Star');
  if (user.streak >= 30 && !user.badges.includes('30-Day Legend')) user.badges.push('30-Day Legend');

  return { streak: user.streak, changed };
}

// @route   POST /api/gamification/daily-ping
// @desc    Called on every app-open / login to keep the streak alive.
//          Safe to call multiple times per day (idempotent for same day).
// @access  Private
router.post('/daily-ping', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const { streak, changed } = applyStreakLogic(user);

    // Add today to activity log (deduplicated by date)
    const todayStr = new Date().toISOString().slice(0, 10);
    const alreadyLogged = user.activityLog.some(d => new Date(d).toISOString().slice(0, 10) === todayStr);
    if (!alreadyLogged) user.activityLog.push(new Date());

    if (changed) await user.save();

    res.json({
      streak,
      lastStudyDate: user.lastStudyDate,
      badges: user.badges,
      xp: user.xp,
      level: user.level,
    });
  } catch (err) {
    console.error('daily-ping error:', err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   POST /api/gamification/session-end
// @desc    Record a completed study session to update hours and streak
// @access  Private
router.post('/session-end', protect, async (req, res) => {
  try {
    const { hoursStudied, goalId } = req.body;
    const user = await User.findById(req.user.id);

    if (!user) return res.status(404).json({ message: 'User not found' });

    user.studyHours += (hoursStudied || 0);
    user.totalStudyHours = (user.totalStudyHours || 0) + (hoursStudied || 0);

    // Auto-Sync to Active Master Goal
    if (goalId) {
      const activeGoal = user.weeklyGoals.id(goalId);
      if (activeGoal) {
        activeGoal.currentHours += (hoursStudied || 0);
        if (activeGoal.currentHours >= activeGoal.targetHours) {
          activeGoal.isCompleted = true;
        }
      }
    }

    // Use shared streak logic
    applyStreakLogic(user);

    // Award badges
    if (user.studyHours >= 10  && !user.badges.includes('Bronze Scholar')) user.badges.push('Bronze Scholar');
    if (user.studyHours >= 50  && !user.badges.includes('Silver Scholar')) user.badges.push('Silver Scholar');
    if (user.studyHours >= 100 && !user.badges.includes('Gold Scholar'))   user.badges.push('Gold Scholar');

    // Award XP and level
    const earnedXp = (hoursStudied || 0) * 100;
    const streakBonus = user.streak * 10;
    user.xp = (user.xp || 0) + earnedXp + streakBonus;
    user.level = Math.floor(user.xp / 100) + 1;

    // Activity log
    const todayStr = new Date().toISOString().slice(0, 10);
    const alreadyLogged = user.activityLog.some(d => new Date(d).toISOString().slice(0, 10) === todayStr);
    if (!alreadyLogged) user.activityLog.push(new Date());

    await user.save();
    
    const io = req.app.get('io');
    if (hoursStudied >= 1) {
      checkAndCompleteQuest(req.user.id, 'LOG_STUDY_HOURS', io).catch(() => {});
    }
    
    res.json(user);
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});


// @route   POST /api/gamification/goals
// @desc    Add a weekly goal
// @access  Private
router.post('/goals', protect, async (req, res) => {
  try {
    const { title, targetHours } = req.body;
    const user = await User.findById(req.user.id);
    user.weeklyGoals.push({ title, targetHours });
    await user.save();
    res.json(user.weeklyGoals);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   PUT /api/gamification/goals/:id
// @desc    Update progress on a goal
// @access  Private
router.put('/goals/:id', protect, async (req, res) => {
  try {
    const { addedHours } = req.body;
    const user = await User.findById(req.user.id);
    
    const goal = user.weeklyGoals.id(req.params.id);
    if (!goal) return res.status(404).json({ message: 'Goal not found' });

    goal.currentHours += addedHours;
    if (goal.currentHours >= goal.targetHours) {
      goal.isCompleted = true;
    }
    
    await user.save();
    res.json(user.weeklyGoals);
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route   DELETE /api/gamification/goals/:id
// @desc    Delete a goal
// @access  Private
router.delete('/goals/:id', protect, async (req, res) => {
   try {
     const user = await User.findById(req.user.id);
     
     // Remove subdoc
     user.weeklyGoals.pull({ _id: req.params.id });
     await user.save();
     
     res.json(user.weeklyGoals);
   } catch (err) {
     res.status(500).json({ message: 'Server Error' });
   }
});

// @route   GET /api/gamification/quests
// @desc    Get or generate daily quests for the user
router.get('/quests', protect, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);

    let quests = await DailyQuest.find({ userId: req.user.id, createdAt: { $gte: today } });
    if (quests.length === 0) {
      const generated = [
        { userId: req.user.id, task: QUEST_TYPES.COMPLETE_FOCUS.task, progress: 0, isCompleted: false },
        { userId: req.user.id, task: QUEST_TYPES.ENDORSE_USER.task, progress: 0, isCompleted: false },
        { userId: req.user.id, task: QUEST_TYPES.LOG_STUDY_HOURS.task, progress: 0, isCompleted: false }
      ];
      quests = await DailyQuest.insertMany(generated);
    }
    res.json(quests);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   PUT /api/gamification/quests/:id
router.put('/quests/:id', protect, async (req, res) => {
  try {
    const quest = await DailyQuest.findOneAndUpdate(
      { _id: req.params.id, userId: req.user.id, isCompleted: false },
      { isCompleted: true },
      { returnDocument: 'after' }
    );
    if (!quest) return res.status(404).json({ message: 'Quest not found or already completed' });

    const user = await User.findById(req.user.id);
    user.xp = (user.xp || 0) + 50; // Quest reward
    user.level = Math.floor(user.xp / 100) + 1;
    await user.save();

    res.json(quest);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   GET /api/gamification/bounties
router.get('/bounties', protect, async (req, res) => {
  try {
    const bounties = await Bounty.find({ status: 'OPEN' }).populate('creatorId', 'name avatar');
    res.json(bounties);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   POST /api/gamification/bounties
router.post('/bounties', protect, async (req, res) => {
  try {
    const bounty = await Bounty.create({ creatorId: req.user.id, title: req.body.title, rewardPoints: req.body.rewardPoints, status: 'OPEN' });
    // populated
    await bounty.populate('creatorId', 'name avatar');
    res.json(bounty);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   POST /api/gamification/endorse/:userId
router.post('/endorse/:userId', protect, async (req, res) => {
  try {
    const { skill } = req.body;
    if (req.user.id === req.params.userId) return res.status(400).json({ message: "Cannot endorse yourself" });
    const existing = await Endorsement.findOne({ endorserId: req.user.id, recipientId: req.params.userId, skill });
    if (existing) return res.status(400).json({ message: "Already endorsed for this skill" });
    
    const endorsement = await Endorsement.create({
      endorserId: req.user.id,
      recipientId: req.params.userId,
      skill
    });
    // Add XP to the recipient
    const recipient = await User.findById(req.params.userId);
    if (recipient) {
      recipient.xp += 50; 
      recipient.level = Math.floor(recipient.xp / 100) + 1;
      await recipient.save();
    }
    
    const io = req.app.get('io');
    checkAndCompleteQuest(req.user.id, 'ENDORSE_USER', io).catch(() => {});
    
    res.json(endorsement);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   GET /api/gamification/endorsements/:userId
router.get('/endorsements/:userId', protect, async (req, res) => {
  try {
    const endorsements = await Endorsement.find({ recipientId: req.params.userId }).populate('endorserId', 'name avatar');
    res.json(endorsements);
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

// @route   POST /api/gamification/reward
// @desc    Arcade Mini-Game Reward Dispatcher
router.post('/reward', protect, async (req, res) => {
  try {
    const { xp, game } = req.body;
    // Hard-Cap maximum XP payout per request to prevent abuse
    if (!xp || typeof xp !== 'number' || xp <= 0 || xp > 100) {
      return res.status(400).json({ message: 'Invalid Reward XP limits crossed.' });
    }
    
    const user = await User.findById(req.user.id);
    user.xp = (user.xp || 0) + xp;
    user.level = Math.floor(user.xp / 100) + 1;
    await user.save();
    
    res.json({ message: `Reward claimed for ${game}`, xp: user.xp, level: user.level });
  } catch (err) { res.status(500).json({ message: 'Server Error' }); }
});

module.exports = router;
