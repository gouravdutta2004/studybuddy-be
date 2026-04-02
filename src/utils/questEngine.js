const DailyQuest = require('../models/DailyQuest');
const User = require('../models/User');

const QUEST_TYPES = {
  SEND_MESSAGE: { task: 'Send 3 messages', goal: 3, xp: 50 },
  CREATE_SESSION: { task: 'Create a study session', goal: 1, xp: 75 },
  JOIN_SESSION: { task: 'Join a study session', goal: 1, xp: 50 },
  COMPLETE_FOCUS: { task: 'Complete a 60-minute Focus Session', goal: 1, xp: 100 },
  ENDORSE_USER: { task: 'Endorse a StudyFriend', goal: 1, xp: 50 },
  LOG_STUDY_HOURS: { task: 'Log 2 total study hours today', goal: 2, xp: 150 }
};

const checkAndCompleteQuest = async (userId, questType, io) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const questConfig = QUEST_TYPES[questType];
    if (!questConfig) return;

    let quest = await DailyQuest.findOne({
      userId,
      task: questConfig.task,
      createdAt: { $gte: today },
      isCompleted: false
    });

    if (!quest) return;

    quest.progress = (quest.progress || 0) + 1;

    if (quest.progress >= questConfig.goal) {
      quest.isCompleted = true;
      
      const user = await User.findById(userId);
      if (user) {
        user.xp = (user.xp || 0) + questConfig.xp;
        user.level = Math.floor(user.xp / 100) + 1;
        await user.save();
      }

      await quest.save();

      if (io) {
        io.to(userId.toString()).emit('quest_completed', {
          questName: questConfig.task,
          xp: questConfig.xp,
          newXp: user.xp,
          newLevel: user.level
        });
      }
    } else {
      await quest.save();
    }
  } catch (err) {
    console.error('Quest engine error:', err);
  }
};

module.exports = { checkAndCompleteQuest, QUEST_TYPES };
