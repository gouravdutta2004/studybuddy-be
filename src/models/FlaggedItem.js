const mongoose = require('mongoose');

const flaggedItemSchema = new mongoose.Schema({
  author: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  originalText: { type: String, required: true },
  source: { type: String, enum: ['Direct Message', 'Study Room Chat', 'Profile Bio'], required: true },
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  status: { type: String, enum: ['pending', 'reviewed', 'dismissed'], default: 'pending' },
}, { timestamps: true });

module.exports = mongoose.model('FlaggedItem', flaggedItemSchema);
