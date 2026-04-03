// routes/pricingRoutes.js
// Public endpoint: GET /api/billing/pricing
// Admin endpoint:  GET/PUT /api/billing/pricing/admin

const express = require('express');
const router = express.Router();
const SystemConfig = require('../models/SystemConfig');
const { protect, admin } = require('../middleware/auth');

const PRICING_KEY = 'billing_pricing';

const DEFAULT_PRICING = {
  pro:   { basePrice: 799,  discount: 0, annualDiscount: 20, name: 'Pro',  description: 'For serious learners who want more.' },
  squad: { basePrice: 1599, discount: 0, annualDiscount: 20, name: 'Team', description: 'Built for study groups and institutions.' },
};

// Helper: apply a percentage discount to a base price
const applyDiscount = (price, pct) => {
  const p = Math.min(Math.max(Number(pct) || 0, 0), 100);
  return Math.round(price * (1 - p / 100));
};

// ─── PUBLIC: GET /api/billing/pricing ──────────────────────────────────
// Returns monthly + annual pricing for Billing page & Landing page
router.get('/pricing', async (req, res) => {
  try {
    const config = await SystemConfig.findOne({ key: PRICING_KEY });
    const raw = config?.value || DEFAULT_PRICING;

    const result = {};
    for (const [key, plan] of Object.entries(raw)) {
      // Monthly effective price (after any promo discount)
      const monthlyPrice = applyDiscount(plan.basePrice, plan.discount);
      const originalPrice = plan.discount > 0 ? plan.basePrice : null;

      // Annual: total billed once a year = monthly effective * 12, then apply annualDiscount
      const annualMonthly = applyDiscount(monthlyPrice, plan.annualDiscount); // per-month displayed for annual
      const annualTotal   = annualMonthly * 12; // total charged

      result[key] = {
        ...plan,
        effectivePrice:  monthlyPrice,    // monthly effective (per month)
        originalPrice,                    // strikethrough if promo discount active
        annualDiscount:  Number(plan.annualDiscount) || 0,
        annualMonthly,                    // per-month price shown for annual billing
        annualTotal,                      // total charged annually (Razorpay amount)
        annualOriginalMonthly: plan.annualDiscount > 0 ? monthlyPrice : null, // strikethrough for annual
      };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: GET /api/billing/pricing/admin ─────────────────────────────
router.get('/pricing/admin', protect, admin, async (req, res) => {
  try {
    const config = await SystemConfig.findOne({ key: PRICING_KEY });
    const raw = config?.value || DEFAULT_PRICING;
    // Ensure annualDiscount always present
    const result = {};
    for (const [k, v] of Object.entries(raw)) {
      result[k] = { ...DEFAULT_PRICING[k], ...v };
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ─── ADMIN: PUT /api/billing/pricing/admin ─────────────────────────────
router.put('/pricing/admin', protect, admin, async (req, res) => {
  try {
    const { pro, squad } = req.body;

    if (!pro?.basePrice || !squad?.basePrice) {
      return res.status(400).json({ message: 'Missing basePrice for pro or squad plan.' });
    }

    const value = {
      pro: {
        basePrice:      Number(pro.basePrice),
        discount:       Number(pro.discount)        || 0,
        annualDiscount: Number(pro.annualDiscount)  || 0,
        name:        'Pro',
        description: pro.description  || DEFAULT_PRICING.pro.description,
      },
      squad: {
        basePrice:      Number(squad.basePrice),
        discount:       Number(squad.discount)        || 0,
        annualDiscount: Number(squad.annualDiscount)  || 0,
        name:        'Team',
        description: squad.description || DEFAULT_PRICING.squad.description,
      },
    };

    await SystemConfig.findOneAndUpdate(
      { key: PRICING_KEY },
      { key: PRICING_KEY, value, isActive: true },
      { upsert: true, new: true }
    );

    res.json({ message: 'Pricing updated globally.', pricing: value });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
