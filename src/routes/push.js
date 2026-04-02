const express = require('express');
const router = express.Router();
const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');
const { protect } = require('../middleware/auth');

// Configure VAPID – must be done before using webpush to send
try {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@studyfriend.co.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('VAPID Push configuration skipped: Missing or invalid keys');
}


// @route  GET /api/push/vapid-public-key
// @desc   Get the VAPID public key so the browser can create a subscription
// @access Public
router.get('/vapid-public-key', (req, res) => {
  res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
});

// @route  POST /api/push/subscribe
// @desc   Save a browser push subscription for the logged-in user
// @access Private
router.post('/subscribe', protect, async (req, res) => {
  try {
    const { subscription } = req.body;
    if (!subscription || !subscription.endpoint) {
      return res.status(400).json({ message: 'Invalid subscription object' });
    }

    // Upsert – avoid duplicates for the same endpoint
    await PushSubscription.findOneAndUpdate(
      { user: req.user.id, 'subscription.endpoint': subscription.endpoint },
      { user: req.user.id, subscription },
      { upsert: true, returnDocument: 'after' }
    );

    res.status(201).json({ message: 'Push subscription saved' });
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route  DELETE /api/push/unsubscribe
// @desc   Remove a push subscription (e.g., when user disables notifications)
// @access Private
router.delete('/unsubscribe', protect, async (req, res) => {
  try {
    const { endpoint } = req.body;
    await PushSubscription.deleteMany({ user: req.user.id, 'subscription.endpoint': endpoint });
    res.json({ message: 'Push subscription removed' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

// @route  POST /api/push/test
// @desc   Send a test push to the logged-in user (dev only)
// @access Private
router.post('/test', protect, async (req, res) => {
  try {
    const { sendPushToUser } = require('../utils/pushNotification');
    await sendPushToUser(req.user.id, {
      title: '🔔 Push Notifications Active!',
      body: 'Your StudyFriend notifications are working perfectly.',
      icon: '/icons.svg',
      url: '/dashboard'
    });
    res.json({ message: 'Test push sent' });
  } catch (err) {
    res.status(500).json({ message: 'Server Error' });
  }
});

module.exports = router;
