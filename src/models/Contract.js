const mongoose = require('mongoose');

const contractSchema = new mongoose.Schema({
  userA: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userB: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  scheduledTime: { type: Date, required: true },
  stakes: { type: Number, default: 500 },
  status: { type: String, enum: ['PENDING', 'ACTIVE', 'COMPLETED', 'BREACHED'], default: 'PENDING' },
  // Tracks who finalized/verified what: 'SHOWED_UP' or 'NO_SHOW'
  verifiedA: { type: String, enum: ['PENDING', 'SHOWED_UP', 'NO_SHOW'], default: 'PENDING' },
  verifiedB: { type: String, enum: ['PENDING', 'SHOWED_UP', 'NO_SHOW'], default: 'PENDING' }
}, { timestamps: true });

module.exports = mongoose.model('Contract', contractSchema);
