const mongoose = require('mongoose');

const studyGroupSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  subject: { type: String, required: true },
  creator: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  isPublic: { type: Boolean, default: true },
  maxMembers: { type: Number, default: 50 },
  avatar: { type: String, default: '' },
  kanbanTasks: [{
    id: { type: String, required: true },
    title: { type: String, required: true },
    status: { type: String, enum: ['To Do', 'Doing', 'Done'], default: 'To Do' },
    assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }
  }],
  resources: [{
    id: { type: String, required: true },
    type: { type: String, enum: ['link', 'pdf', 'image', 'other'], default: 'link' },
    url: { type: String, required: true },
    title: { type: String, required: true },
    uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    createdAt: { type: Date, default: Date.now }
  }]
}, { timestamps: true });

module.exports = mongoose.model('StudyGroup', studyGroupSchema);
