const express = require('express');
const router = express.Router();
const User = require('../models/User');
const SystemConfig = require('../models/SystemConfig');
const { protect } = require('../middleware/auth');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const PRICING_KEY = 'billing_pricing';
const DEFAULT_AMOUNTS = { pro: 79900, squad: 159900 }; // paise fallback (monthly)

// Helper: apply % discount
const applyDiscount = (price, pct) => {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 100);
  return Math.round(price * (1 - p / 100));
};

// Dynamic plan amount — reads admin-set price from DB (in paise)
// billingCycle: 'monthly' | 'annual'
async function getPlanAmountPaise(plan, billingCycle = 'monthly') {
  try {
    const config = await SystemConfig.findOne({ key: PRICING_KEY });
    if (config?.value?.[plan]?.basePrice) {
      const raw = config.value[plan];
      const monthlyEffective = applyDiscount(raw.basePrice, raw.discount);
      if (billingCycle === 'annual') {
        const annualMonthly = applyDiscount(monthlyEffective, raw.annualDiscount);
        return annualMonthly * 12 * 100; // 12 months in paise
      }
      return monthlyEffective * 100; // monthly in paise
    }
  } catch { /* fall through */ }
  const fallback = DEFAULT_AMOUNTS[plan] || 0;
  return billingCycle === 'annual' ? fallback * 12 : fallback;
}

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
      billingCycle: user.subscription?.billingCycle || 'monthly',
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
      const amount = DEFAULT_AMOUNTS[user.subscription.plan] || 0;
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
    const { plan, billingCycle = 'monthly' } = req.body;

    if (!['pro', 'squad'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid or free plan — no order needed.' });
    }
    if (!['monthly', 'annual'].includes(billingCycle)) {
      return res.status(400).json({ message: 'Invalid billingCycle. Must be monthly or annual.' });
    }

    // Always fetch the admin-controlled dynamic price
    const amount = await getPlanAmountPaise(plan, billingCycle);

    if (!REAL_KEY) {
      return res.json({
        orderId: `order_mock_${Date.now()}`,
        amount,
        currency: 'INR',
        key_id: 'rzp_test_mock',
        isMock: true,
        billingCycle,
      });
    }

    const receipt = `rcpt_${req.user.id.toString().slice(-8)}_${Date.now()}`.substring(0, 40);
    const order = await razorpay.orders.create({ amount, currency: 'INR', receipt });

    res.json({
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      key_id: process.env.RAZORPAY_KEY_ID,
      isMock: false,
      billingCycle,
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
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan, isMock, billingCycle = 'monthly' } = req.body;

    if (!['pro', 'squad'].includes(plan)) {
      return res.status(400).json({ message: 'Invalid plan for verification.' });
    }

    if (isMock) {
      if (razorpay_signature !== 'mock_signature' && razorpay_signature !== 'mock_sig') {
        return res.status(400).json({ message: 'Invalid mock signature.' });
      }
    } else {
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
    if (billingCycle === 'annual') {
      activeUntil.setFullYear(activeUntil.getFullYear() + 1);
    } else {
      activeUntil.setMonth(activeUntil.getMonth() + 1);
    }

    user.subscription = { plan, activeUntil, billingCycle };
    await user.save();

    res.json({
      message: `🎉 Successfully upgraded to ${PLAN_LABELS[plan]} (${billingCycle})!`,
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
