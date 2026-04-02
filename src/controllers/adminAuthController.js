const jwt = require('jsonwebtoken');
const User = require('../models/User');

const generateToken = (id, role) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check User database for ORG_ADMIN
    const user = await User.findOne({ email });

    if (!user || !(await user.matchPassword(password))) {
      return res.status(401).json({ message: 'Invalid Admin credentials' });
    }
    
    if (user.role !== 'ORG_ADMIN' && user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'Admin Access Required. You are not authorized to use this portal.' });
    }

    if (!user.isActive) {
      return res.status(403).json({ message: 'Admin account blocked by super admin' });
    }
      
    const userData = user.toJSON();
    res.json({ token: generateToken(user._id, user.role), user: userData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { login };
