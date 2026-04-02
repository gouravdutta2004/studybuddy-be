const mongoose = require('mongoose');

const pushSubscriptionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  subscription: {
    endpoint: { type: String, required: true },
    keys: {
      p256dh: String,
      auth: String
    }
  }
}, { timestamps: true });

// Each user can have multiple endpoints (multiple browsers/devices)
pushSubscriptionSchema.index({ user: 1 });

module.exports = mongoose.model('PushSubscription', pushSubscriptionSchema);
