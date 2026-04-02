const mongoose = require('mongoose');

const bountySchema = new mongoose.Schema({
  creatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  rewardPoints: { type: Number, required: true },
  status: { type: String, enum: ['OPEN', 'CLAIMED'], default: 'OPEN' }
}, { timestamps: true });

module.exports = mongoose.model('Bounty', bountySchema);
