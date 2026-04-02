const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true, minlength: 6 },
  adminRole: { 
    type: String, 
    enum: ['Super Admin', 'Moderator', 'Support Agent'], 
    default: 'Super Admin' 
  },
  avatar: { type: String, default: '' },
  bio: { type: String, default: '', maxlength: 300 },
  subjects: [{ type: String }],
  educationLevel: {
    type: String,
    enum: ['High School', 'Undergraduate', 'Graduate', 'PhD', 'Self-Learner', 'Other'],
    default: 'Undergraduate'
  },
  university: { type: String, default: '' },
  location: { type: String, default: '' },
  studyStyle: {
    type: String,
    enum: ['Visual', 'Auditory', 'Reading/Writing', 'Kinesthetic', 'Mixed'],
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
  isActive: { type: Boolean, default: true },
  resetPasswordToken: String,
  resetPasswordExpire: Date
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

module.exports = mongoose.model('Admin', userSchema);
