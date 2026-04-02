const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Admin = require('../models/Admin');
const Settings = require('../models/Settings');
const crypto = require('crypto');
const sendEmail = require('../utils/sendEmail');
const { OAuth2Client } = require('google-auth-library');
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const generateToken = (id, role) => {
  if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
  return jwt.sign({ id, role }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

const Organization = require('../models/Organization');

const register = async (req, res) => {
  try {
    const { name, email, password, isGlobalUser, collegeData } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Please provide name, email, and password' });
      
    const exists = await User.findOne({ email });
    if (exists) return res.status(400).json({ message: 'Email already registered' });
    
    let role = 'USER';
    let verificationStatus = 'APPROVED'; // Global users bypass walled-gardens explicitly.
    let orgId = undefined;

    if (!isGlobalUser) {
      if (!collegeData || !collegeData.name || !collegeData.domain) {
        return res.status(400).json({ message: 'Please provide valid college data or opt in as a global user.' });
      }

      let org = await Organization.findOne({ domain: collegeData.domain });
      if (!org) {
        org = await Organization.create({
          name: collegeData.name,
          domain: collegeData.domain,
          authorizedAdmins: []
        });
      }

      orgId = org._id;
      verificationStatus = 'PENDING';
      
      // Check Admin Claim
      if (org.authorizedAdmins && org.authorizedAdmins.map(e => e.toLowerCase()).includes(email.toLowerCase())) {
        role = 'ORG_ADMIN';
        verificationStatus = 'APPROVED';
      }
      // Strict Walled Garden: All other typical students remain PENDING until explicitly approved by the Org Admin.
    }

    const user = await User.create({ 
      name, 
      email, 
      password,
      organization: orgId,
      role,
      verificationStatus
    });
    
    // Fire-and-forget: do NOT await — send email in background so response is instant
    Settings.findOne().then(settings => {
      const template = settings?.emailTemplateWelcome || "<h1>Welcome {name}!</h1><p>We are glad to have you.</p>";
      const welcomeHtml = template.replace(/{name}/g, user.name);
      sendEmail({
        email: user.email,
        subject: 'Welcome to StudyFriend!',
        message: `Welcome ${user.name}!`,
        html: welcomeHtml
      }).catch(err => console.error('Welcome email dispatch suppressed:', err.message));
    }).catch(err => console.error('Settings query failed', err));
    
    res.status(201).json({ token: generateToken(user._id, role.toLowerCase()), user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getOrganizations = async (req, res) => {
  try {
    const orgs = await Organization.find({}).select('name domain');
    res.json(orgs);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    
    // Check Admin database first
    let user = await Admin.findOne({ email });
    let role = 'admin';
    
    if (!user) {
      // Fallback to User database
      user = await User.findOne({ email });
      role = 'user';
    }

    if (!user || !(await user.matchPassword(password)))
      return res.status(401).json({ message: 'Invalid email or password' });
    if (!user.isActive)
      return res.status(403).json({ message: 'Account blocked by administrator' });
      
    const userData = user.toJSON();
    if (role === 'admin') userData.isAdmin = true; // Inject explicitly for frontend logic
    
    res.json({ token: generateToken(user._id, role), user: userData });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMe = async (req, res) => {
  const userData = req.user.toJSON();
  if (req.user.role === 'admin') userData.isAdmin = true;
  res.json(userData);
};

const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    let user = await Admin.findOne({ email });
    let role = 'admin';
    if (!user) {
      user = await User.findOne({ email });
      role = 'user';
    }
    
    if (!user) {
      return res.status(404).json({ message: 'There is no user with that email' });
    }

    const resetToken = crypto.randomBytes(20).toString('hex');
    
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 10 * 60 * 1000;
    
    await user.save({ validateBeforeSave: false });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetUrl = `${frontendUrl}/reset-password/${resetToken}`;

    const settings = await Settings.findOne();
    const template = settings?.emailTemplateReset || '<h1>Reset Password</h1><p>Click <a href="{link}">here</a> to reset.</p>';
    const resetHtml = template.replace(/{link}/g, resetUrl).replace(/{name}/g, user.name);

    const message = `You are receiving this email because you (or someone else) has requested the reset of a password. Please go to: \n\n ${resetUrl}`;

    try {
      await sendEmail({
        email: user.email,
        subject: 'Password reset token',
        message: message,
        html: resetHtml,
        resetUrl: resetUrl
      });

      res.status(200).json({ success: true, message: 'Email sent' });
    } catch (err) {
      user.resetPasswordToken = undefined;
      user.resetPasswordExpire = undefined;
      await user.save({ validateBeforeSave: false });
      return res.status(500).json({ message: 'Email could not be sent' });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const resetPassword = async (req, res) => {
  try {
    const resetPasswordToken = crypto.createHash('sha256').update(req.params.token).digest('hex');

    let user = await Admin.findOne({
      resetPasswordToken,
      resetPasswordExpire: { $gt: Date.now() }
    });
    
    if (!user) {
      user = await User.findOne({
        resetPasswordToken,
        resetPasswordExpire: { $gt: Date.now() }
      });
    }

    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired token' });
    }

    user.password = req.body.password;
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    res.status(200).json({ success: true, message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Please provide current and new passwords' });
    }
    
    let user = await Admin.findById(req.user._id);
    if (!user) {
      user = await User.findById(req.user._id);
    }
    
    if (!user || !(await user.matchPassword(currentPassword))) {
      return res.status(401).json({ message: 'Incorrect current password' });
    }
    
    user.password = newPassword;
    await user.save();
    
    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const googleAuth = async (req, res) => {
  try {
    const { credential } = req.body;
    if (!credential) return res.status(400).json({ message: 'No signature provided' });

    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    
    const payload = ticket.getPayload();
    const { email, name, picture } = payload;

    let user = await Admin.findOne({ email });
    let role = 'admin';

    if (!user) {
      user = await User.findOne({ email });
      role = 'user';
    }

    if (!user) {
      const { isGlobalUser, collegeData } = req.body;

      let newRole = 'USER';
      let verificationStatus = 'APPROVED';
      let orgId = undefined;

      if (!isGlobalUser) {
        if (!collegeData || !collegeData.name || !collegeData.domain) {
          return res.status(404).json({ message: 'Account not found. Please register to select an institution first.' });
        }

        let org = await Organization.findOne({ domain: collegeData.domain });
        if (!org) {
          org = await Organization.create({
            name: collegeData.name,
            domain: collegeData.domain,
            authorizedAdmins: []
          });
        }
        
        orgId = org._id;
        verificationStatus = 'PENDING';
        
        // Admin Claim check
        if (org.authorizedAdmins && org.authorizedAdmins.map(e => e.toLowerCase()).includes(email.toLowerCase())) {
          newRole = 'ORG_ADMIN';
          verificationStatus = 'APPROVED';
        }
        // Strict Walled Garden: All other typical students remain PENDING until explicitly approved by the Org Admin.
      }

      const randomPassword = crypto.randomBytes(20).toString('hex');
      user = await User.create({
        name,
        email,
        password: randomPassword,
        avatar: picture,
        organization: orgId,
        role: newRole,
        verificationStatus
      });
      role = 'user';
      
      // Fire-and-forget: do NOT await — send email in background so response is instant
      Settings.findOne().then(settings => {
        const template = settings?.emailTemplateWelcome || "<h1>Welcome {name}!</h1><p>We are glad to have you.</p>";
        const welcomeHtml = template.replace(/{name}/g, user.name);
        sendEmail({
          email: user.email,
          subject: 'Welcome to StudyFriend!',
          message: `Welcome ${user.name}!`,
          html: welcomeHtml
        }).catch(err => console.error('Welcome email dispatch suppressed:', err.message));
      }).catch(err => console.error('Settings query failed', err));
    }

    if (!user.isActive) return res.status(403).json({ message: 'Account blocked by administrator' });

    const userData = user.toJSON();
    if (role === 'admin') userData.isAdmin = true;

    res.json({ token: generateToken(user._id, role), user: userData });
  } catch (err) {
    console.error('Google Auth Error:', err);
    res.status(500).json({ message: 'Google Authentication failed. Please check your GOOGLE_CLIENT_ID.' });
  }
};

module.exports = { register, login, getMe, forgotPassword, resetPassword, changePassword, googleAuth, getOrganizations };
