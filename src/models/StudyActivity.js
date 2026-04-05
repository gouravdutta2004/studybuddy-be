/**
 * StudyActivity — per-user proof-of-work log
 * Records every quiz completion and study hub attendance.
 * Separate from the global ActivityLog (which is the social feed).
 */
const mongoose = require('mongoose');

const studyActivitySchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  actionType: {
    type: String,
    enum: ['QUIZ_COMPLETED', 'HUB_ATTENDED', 'FLASHCARD_SET', 'FOCUS_SESSION'],
    required: true,
  },
  title:     { type: String,  required: true,  maxlength: 120 },
  subject:   { type: String,  default: 'General' },
  score:     { type: Number,  min: 0, max: 100, default: null }, // null for non-scored activities
  maxScore:  { type: Number,  default: 100 },
  timeSpent: { type: Number,  default: 0 },   // minutes
  xpEarned:  { type: Number,  default: 0 },
  multiplier:{ type: Number,  default: 1.0 }, // bonus multiplier applied
}, { timestamps: true });

// Index for fast profile feed lookup  
studyActivitySchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('StudyActivity', studyActivitySchema);
