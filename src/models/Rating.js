const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'Session', required: true },
  reviewer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetUser: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  rating: { type: Number, required: true, min: 1, max: 5 },
  review: { type: String, maxlength: 500 },
}, { timestamps: true });

// Prevent multiple ratings by same user for same target in the same session
ratingSchema.index({ session: 1, reviewer: 1, targetUser: 1 }, { unique: true });

module.exports = mongoose.model('Rating', ratingSchema);
