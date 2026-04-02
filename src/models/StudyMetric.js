const mongoose = require('mongoose');

const studyMetricSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  date: { type: Date, required: true },
  hours: { type: Number, required: true },
  conceptsLearned: { type: Number, default: 0 }
}, { timestamps: true });

module.exports = mongoose.model('StudyMetric', studyMetricSchema);
