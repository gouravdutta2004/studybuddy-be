const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { protect } = require('../middleware/auth');
const Razorpay = require('razorpay');
const crypto = require('crypto');

// Determine if we are running with real Razorpay keys (test OR live)
const keyId = process.env.RAZORPAY_KEY_ID || '';
const REAL_KEY = (keyId.startsWith('rzp_test_') || keyId.startsWith('rzp_live_')) &&
                 !keyId.includes('REPLACE') &&
                 keyId.length > 10;

const razorpay = REAL_KEY
  ? new Razorpay({
      key_id: process.env.RAZORPAY_KEY_ID,
      key_secret: process.env.RAZORPAY_KEY_SECRET,
    })
  : null;

const PLAN_AMOUNTS = { pro: 79900, squad: 159900 }; // paise
const PLAN_LABELS  = { basic: 'Basic', pro: 'Pro', squad: 'Squad' };

// ─────────────────────────────────────────────────────────────
// GET /api/billing/status
// Returns the current user's subscription plan + expiry
// ─────────────────────────────────────────────────────────────
router.get('/status', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('subscription name email');
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({
      plan: user.subscription?.plan || 'basic',
      activeUntil: user.subscription?.activeUntil || null,
      isRealGateway: REAL_KEY,
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/billing/history
// Returns mock payment history (real implementation needs a Payment model)
// ─────────────────────────────────────────────────────────────
router.get('/history', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('subscription createdAt');
    const history = [];

    if (user?.subscription?.plan && user.subscription.plan !== 'basic') {
      const amount = PLAN_AMOUNTS[user.subscription.plan] || 0;
      history.push({
        id: `pay_hist_${user._id}`,
        date: user.subscription.activeUntil
          ? new Date(new Date(user.subscription.activeUntil) - 365 * 24 * 60 * 60 * 1000)
          : user.createdAt,
        plan: user.subscription.plan,
        amount: amount / 100,
        currency: 'INR',
        status: 'paid',
      });
    }

    res.json(history);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/billing/create-order
// Creates a Razorpay order (or mock in dev mode)
// ─────────────────────────────────────────────────────────────
router.post('/create-order', protect, async (req, res) => {
  try {
    const { plan } = req.body;

    if (!['pro', 'squad'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid or free plan — no order needed.' });
    }

    const amount = PLAN_AMOUNTS[plan];

    if (!REAL_KEY) {
      // Dev / demo mode — return a mock order
      return res.json({
        orderId: `order_mock_${Date.now()}`,
        amount,
        currency: 'INR',
        key_id: 'rzp_test_mock',
        isMock: true,
      });
    }

    // Real Razorpay order
    const receipt = `rcpt_${req.user.id.toString().slice(-8)}_${Date.now()}`.substring(0, 40);
    const order = await razorpay.orders.create({ amount, currency: 'INR', receipt });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      isMock: false,
    });
  } catch (err) {
    console.error('Create order error:', err);
    res.status(500).json({ message: 'Could not create payment order. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/billing/verify
// Verifies Razorpay signature and upgrades the user's plan
// ─────────────────────────────────────────────────────────────
router.post('/verify', protect, async (req, res) => {
  try {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, isMock } = req.body;

    if (!['pro', 'squad'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan for verification.' });
    }

    if (isMock) {
      // Mock mode — skip signature check
      if (razorpay_signature !== 'mock_signature') {
        return res.status(400).json({ message: 'Invalid mock signature.' });
      }
    } else {
      // Real signature verification
      const body   = `${razorpay_order_id}|${razorpay_payment_id}`;
      const expected = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(body)
        .digest('hex');

      if (expected !== razorpay_signature) {
        return res.status(400).json({ message: 'Payment verification failed — signature mismatch.' });
      }
    }

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const activeUntil = new Date();
    activeUntil.setFullYear(activeUntil.getFullYear() + 1);

    user.subscription = { plan, activeUntil };
    await user.save();

    res.json({
      message: `🎉 Successfully upgraded to ${PLAN_LABELS[plan]}!`,
      subscription: user.subscription,
    });
  } catch (err) {
    console.error('Verify error:', err);
    res.status(500).json({ message: 'Payment verification error. Please contact support.' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/billing/cancel
// Downgrades user back to Basic plan
// ─────────────────────────────────────────────────────────────
router.post('/cancel', protect, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    user.subscription = { plan: 'basic', activeUntil: null };
    await user.save();

    res.json({ message: 'Subscription cancelled. You are now on the Basic plan.', subscription: user.subscription });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
