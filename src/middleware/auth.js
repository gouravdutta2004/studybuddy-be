const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');

const protect = async (req, res, next) => {
  let token;
  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }
  if (!token) return res.status(401).json({ message: 'Not authorized, no token' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role === 'admin') {
      req.user = await Admin.findById(decoded.id).select('-password');
    } else {
      req.user = await User.findById(decoded.id).select('-password');
    }
    
    if (!req.user) return res.status(401).json({ message: 'User not found' });
    if (decoded.role === 'admin') {
      req.user.role = 'admin'; // Legacy stamp for SUPER_ADMINs
    }
    
    // BACKEND SECURE LOCK: Walled Garden protection
    // Block PENDING users from accessing the network API, except allowing them to fetch their base profile to know they are pending
    if (req.user.verificationStatus === 'PENDING' && req.originalUrl !== '/api/auth/me') {
      return res.status(403).json({ message: 'Account strictly pending organizational approval.' });
    }

    next();
  } catch (err) {
    const message = err.name === 'TokenExpiredError'
      ? 'Token expired, please log in again'
      : 'Not authorized, token failed';
    return res.status(401).json({ message });
  }
};
const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an admin' });
  }
};

const isOrgAdmin = (req, res, next) => {
  if (req.user && (req.user.role === 'ORG_ADMIN' || req.user.role === 'admin' || req.user.isAdmin)) {
    next();
  } else {
    res.status(403).json({ message: 'Not authorized as an Organization Admin' });
  }
};

module.exports = { protect, admin, isOrgAdmin };
