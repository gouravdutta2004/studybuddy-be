const mongoose = require('mongoose');

const organizationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  domain: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  authorizedAdmins: [{
    type: String,
    lowercase: true,
    trim: true
  }]
}, { timestamps: true });

module.exports = mongoose.model('Organization', organizationSchema);
