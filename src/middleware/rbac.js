const authorizeRole = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: 'User not authenticated' });
    }
    
    // Check if the user is an admin and possesses the required role
    // Super Admins automatically bypass local role restrictions
    const currentRole = req.user.adminRole || 'Super Admin';
    
    if (currentRole === 'Super Admin' || roles.includes(currentRole)) {
      next();
    } else {
      res.status(403).json({ message: `Access Denied: ${currentRole} role does not have authorization to access this resource` });
    }
  };
};

module.exports = authorizeRole;
