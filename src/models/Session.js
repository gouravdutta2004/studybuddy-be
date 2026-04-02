const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, default: '' },
  subject: { type: String, required: true },
  host: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  participants: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  maxParticipants: { type: Number, default: 5 },
  scheduledAt: { type: Date, required: true },
  duration: { type: Number, default: 60 }, // minutes
  isOnline: { type: Boolean, default: true },
  meetingLink: { type: String, default: '' },
  location: { type: String, default: '' },
  status: { type: String, enum: ['upcoming', 'ongoing', 'completed', 'cancelled'], default: 'upcoming' },
  notes: [{
      url: String,
      name: String,
      uploadedBy: String
  }],
  recurrence: { type: String, enum: ['NONE', 'WEEKLY'], default: 'NONE' },
  rsvps: [{
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: { type: String, enum: ['ATTENDING', 'PENDING', 'DECLINED'], default: 'PENDING' }
  }],
  collabNotes: { type: String, default: '' }

}, { timestamps: true });

module.exports = mongoose.model('Session', sessionSchema);
