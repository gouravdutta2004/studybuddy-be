const express = require('express');
const router = express.Router();
const Contract = require('../models/Contract');
const User = require('../models/User');
const { protect } = require('../middleware/auth');

// Propose a new contract
router.post('/propose', protect, async (req, res) => {
  try {
    const { targetUserId, scheduledTime, stakes } = req.body;
    if (!targetUserId || !scheduledTime) return res.status(400).json({ message: 'Missing target user or time' });
    
    const userA = await User.findById(req.user._id);
    if (userA.xp < stakes) return res.status(400).json({ message: "You don't have enough XP for these stakes." });

    const contract = await Contract.create({
      userA: req.user._id,
      userB: targetUserId,
      scheduledTime,
      stakes: stakes || 500
    });

    res.status(201).json(contract);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get user's contracts
router.get('/', protect, async (req, res) => {
  try {
    const contracts = await Contract.find({
      $or: [{ userA: req.user._id }, { userB: req.user._id }]
    }).populate('userA userB', 'name avatar xp');
    
    res.json(contracts);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Accept stakes (lock in)
router.post('/:id/accept', protect, async (req, res) => {
  try {
    const contract = await Contract.findById(req.params.id);
    if (!contract) return res.status(404).json({ message: 'Contract not found' });
    if (contract.userB.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not authorized to accept' });
    
    const userB = await User.findById(req.user._id);
    if (userB.xp < contract.stakes) return res.status(400).json({ message: "You don't have enough XP to match these stakes." });

    contract.status = 'ACTIVE';
    await contract.save();
    res.json(contract);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Verify attendance (Verification Engine)
router.post('/:id/verify', protect, async (req, res) => {
  try {
    const { didShowUp } = req.body; // boolean
    const contract = await Contract.findById(req.params.id);
    
    if (!contract || contract.status !== 'ACTIVE') return res.status(400).json({ message: 'Invalid or inactive contract' });

    const isUserA = contract.userA.toString() === req.user._id.toString();
    const isUserB = contract.userB.toString() === req.user._id.toString();

    if (!isUserA && !isUserB) return res.status(403).json({ message: 'Not a party to this contract' });

    // Mark current user's response
    const statusVal = didShowUp ? 'SHOWED_UP' : 'NO_SHOW';
    if (isUserA) contract.verifiedA = statusVal;
    if (isUserB) contract.verifiedB = statusVal;

    // Check if both have responded
    if (contract.verifiedA !== 'PENDING' && contract.verifiedB !== 'PENDING') {
      if (contract.verifiedA === 'SHOWED_UP' && contract.verifiedB === 'SHOWED_UP') {
        contract.status = 'COMPLETED';
        // Reward both users for keeping their word
        await User.findByIdAndUpdate(contract.userA, { $inc: { xp: contract.stakes * 0.5, 'studyProfile.consistencyScore': 5 } });
        await User.findByIdAndUpdate(contract.userB, { $inc: { xp: contract.stakes * 0.5, 'studyProfile.consistencyScore': 5 } });
      } else {
        contract.status = 'BREACHED';
        
        // Penalize No-Shows
        if (contract.verifiedA === 'NO_SHOW') {
           await User.findByIdAndUpdate(contract.userA, { $inc: { xp: -contract.stakes, 'studyProfile.consistencyScore': -10 } });
        }
        if (contract.verifiedB === 'NO_SHOW') {
           await User.findByIdAndUpdate(contract.userB, { $inc: { xp: -contract.stakes, 'studyProfile.consistencyScore': -10 } });
        }
      }
    }

    await contract.save();
    res.json(contract);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
