const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 300 },
  subjects: [{ type: String }],
  educationLevel: {
    type: String,
    enum: ['High School', 'Undergraduate', 'Graduate', 'PhD', 'Self-Learner', 'Other'],
    default: 'Undergraduate'
  },
  university: { type: String, default: '' },
  studyStyle: {
    type: String,
    enum: ['Visual', 'Auditory', 'Reading/Writing', 'Kinesthetic', 'Mixed', 'Pomodoro'],
    default: 'Mixed'
  },
  availability: [{
    day: { type: String, enum: ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'] },
    startTime: String,
    endTime: String
  }],
  preferOnline: { type: Boolean, default: true },
  connections: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  pendingRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  sentRequests: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  skippedMatches: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isActive: { type: Boolean, default: true },
  resetPasswordToken: String,
  resetPasswordExpire: Date,
  major: { type: String, default: '' },
  currentStreak: { type: Number, default: 0 },
  league: { type: String, enum: ['BRONZE', 'SILVER', 'GOLD', 'ELITE'], default: 'BRONZE' },
  totalStudyHours: { type: Number, default: 0 },
  studyHours: { type: Number, default: 0 },
  streak: { type: Number, default: 0 },
  lastStudyDate: { type: Date, default: null },
  xp: { type: Number, default: 0 },
  level: { type: Number, default: 1 },
  badges: [{ type: String }],
  socialLinks: {
    github:    { type: String, default: '' },
    linkedin:  { type: String, default: '' },
    instagram: { type: String, default: '' },
    twitter:   { type: String, default: '' },
    facebook:  { type: String, default: '' },
    youtube:   { type: String, default: '' },
  },
  isVerified: { type: Boolean, default: false },
  weeklyGoals: [{
    title: { type: String, required: true },
    targetHours: { type: Number, required: true },
    currentHours: { type: Number, default: 0 },
    isCompleted: { type: Boolean, default: false }
  }],
  activityLog: [{ type: Date }], // For GitHub-style heatmap
  timezone: { type: String, default: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' },
  subscription: {
    plan: { type: String, enum: ['basic', 'pro', 'squad'], default: 'basic' },
    activeUntil: { type: Date }
  },
  role: { type: String, enum: ['USER', 'ORG_ADMIN', 'SUPER_ADMIN'], default: 'USER' },
  organization: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: false },
  verificationStatus: { type: String, enum: ['APPROVED', 'PENDING', 'REJECTED'], default: 'APPROVED' },
  kycStatus: { type: String, enum: ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED'], default: 'UNVERIFIED' },
  verificationDetails: {
    verifiedInstitution: { type: String, default: '' },
    verifiedUntil: { type: Date, default: null }
  },
  studyProfile: {
    focusSpan: { type: String, enum: ['POMODORO', 'DEEP_WORK', ''] },
    learningType: { type: String, enum: ['VISUAL', 'THEORY', 'PROBLEM_SOLVING', ''] },
    energyPeak: { type: String, enum: ['MORNING', 'NIGHT_OWL', ''] },
    consistencyScore: { type: Number, default: 100 },
    reliabilityRating: { type: Number, default: 5.0 }
  }
}, { timestamps: true });



userSchema.pre('save', async function () {
  if (!this.isModified('password')) return;
  this.password = await bcrypt.hash(this.password, 12);
});

userSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

userSchema.methods.toJSON = function () {
  const obj = this.toObject();
  delete obj.password;
  return obj;
};

module.exports = mongoose.model('User', userSchema);
