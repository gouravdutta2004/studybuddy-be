const mongoose = require('mongoose');

const endorsementSchema = new mongoose.Schema({
  endorserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  recipientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  skill: { type: String, required: true },
}, { timestamps: true });

module.exports = mongoose.model('Endorsement', endorsementSchema);
