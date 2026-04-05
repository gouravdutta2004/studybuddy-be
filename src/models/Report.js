const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema({
  reporterId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reportedUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  reason: {
    type: String,
    enum: ['HARASSMENT', 'NSFW', 'SPAM', 'OFF_TOPIC'],
    required: true,
  },
  notes:  { type: String, default: '', maxlength: 1000 },
  status: { type: String, enum: ['PENDING', 'REVIEWED'], default: 'PENDING' },
  // Context snapshot for admin review
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Session' },
}, { timestamps: true });

// Prevent duplicate reports from the same reporter→reported pair per session
reportSchema.index({ reporterId: 1, reportedUserId: 1, sessionId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('Report', reportSchema);
