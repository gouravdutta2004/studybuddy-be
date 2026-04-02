const webpush = require('web-push');
const PushSubscription = require('../models/PushSubscription');

try {
  webpush.setVapidDetails(
    process.env.VAPID_EMAIL || 'mailto:admin@studyfriend.co.in',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
} catch (e) {
  console.warn('VAPID Push configuration skipped: Missing or invalid keys');
}

/**
 * Send a browser push notification to a user by their userId.
 * @param {string} userId - MongoDB user ID
 * @param {object} payload - { title, body, icon, url }
 */
const sendPushToUser = async (userId, payload) => {
  try {
    if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
      console.log(`[Mock Push] Would send to ${userId}: ${payload.title}`);
      return;
    }
    const subs = await PushSubscription.find({ user: userId });
    if (!subs || subs.length === 0) return;

    const notification = JSON.stringify(payload);

    const results = await Promise.allSettled(
      subs.map(sub => webpush.sendNotification(sub.subscription, notification))
    );

    // Clean up expired/invalid subscriptions (410 Gone)
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') {
        const statusCode = result.reason?.statusCode;
        if (statusCode === 410 || statusCode === 404) {
          // Subscription expired or invalid; remove it
          await PushSubscription.findByIdAndDelete(subs[i]._id);
        }
      }
    }
  } catch (err) {
    console.error('Push notification error:', err.message);
  }
};

module.exports = { sendPushToUser };
