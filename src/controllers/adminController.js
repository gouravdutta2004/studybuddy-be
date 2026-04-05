const User = require('../models/User');
const Admin = require('../models/Admin');
const Feedback = require('../models/Feedback');
const Report = require('../models/Report');
const FlaggedItem = require('../models/FlaggedItem');
const Subject = require('../models/Subject');
const Session = require('../models/Session');
const Organization = require('../models/Organization');
const AuditLog = require('../models/AuditLog');
const SystemConfig = require('../models/SystemConfig');
const Settings = require('../models/Settings');
const StudyGroup = require('../models/StudyGroup');
const DailyQuest = require('../models/DailyQuest');
const mongoose = require('mongoose');
const sendEmail = require('../utils/sendEmail');
const os = require('os-utils');

const getUsers = async (req, res) => {
  try {
    const users = await User.find({}).select('-password').lean();
    const admins = await Admin.find({}).select('-password').lean();
    
    const mappedUsers = users.map(u => ({ ...u, isAdmin: false }));
    const mappedAdmins = admins.map(a => ({ ...a, isAdmin: true }));
    
    res.json([...mappedAdmins, ...mappedUsers]);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateUser = async (req, res) => {
  try {
    let target = await Admin.findById(req.params.id);
    let isAdminCollection = true;
    
    if (!target) {
      target = await User.findById(req.params.id);
      isAdminCollection = false;
    }
    if (!target) return res.status(404).json({ message: 'User not found' });
    
    if (target.email === 'admin@test.com' && req.body.isAdmin === false) {
      return res.status(403).json({ message: 'Cannot revoke privileges from the super admin' });
    }
    if (target.email === 'admin@test.com' && req.body.email && req.body.email !== 'admin@test.com') {
      return res.status(403).json({ message: 'Cannot redefine super admin root email bindings' });
    }

    target.isActive = req.body.isActive !== undefined ? req.body.isActive : target.isActive;
    
    const fields = ['name', 'email', 'bio', 'avatar', 'subjects', 'educationLevel', 'university', 'location', 'studyStyle', 'availability', 'preferOnline', 'timezone', 'weeklyGoals'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) target[f] = req.body[f];
    });
    // Never allow direct password update through admin panel — must go through reset flow
    if (req.body.password) {
      return res.status(400).json({ message: 'Password changes must be done through the reset password flow.' });
    }

    let updatedObj;

    // Handle cross-collection promotion/demotion
    if (req.body.isAdmin === true && !isAdminCollection) {
      // Promote: User -> Admin
      const rawData = target.toObject();
      rawData.adminRole = 'Moderator'; // Default assignment
      await Admin.collection.insertOne(rawData);
      await User.findByIdAndDelete(target._id);
      
      const newAdmin = await Admin.findById(target._id);
      updatedObj = newAdmin.toJSON();
      isAdminCollection = true;
    } 
    else if (req.body.isAdmin === false && isAdminCollection) {
      // Demote: Admin -> User
      const rawData = target.toObject();
      await User.collection.insertOne(rawData);
      await Admin.findByIdAndDelete(target._id);
      
      const newUser = await User.findById(target._id);
      updatedObj = newUser.toJSON();
      isAdminCollection = false;
    } 
    else {
      // Standard intra-collection update
      const updatedUser = await target.save();
      updatedObj = updatedUser.toJSON();
    }

    updatedObj.isAdmin = isAdminCollection;
    res.json(updatedObj);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'This email is already registered to another user' });
    res.status(500).json({ message: err.message });
  }
};

const deleteUser = async (req, res) => {
  try {
    const adminExists = await Admin.findById(req.params.id);
    if (adminExists) return res.status(400).json({ message: 'Cannot delete an admin user' });
    
    const userExists = await User.findById(req.params.id);
    if (!userExists) return res.status(404).json({ message: 'User not found' });
    
    await User.findByIdAndDelete(req.params.id);
    res.json({ message: 'User removed successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createUser = async (req, res) => {
  try {
    const { name, email, password, isAdmin, isActive, role, organization } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: 'Name, email, and password are required' });
    
    if (await User.findOne({ email }) || await Admin.findOne({ email })) {
      return res.status(400).json({ message: 'Email already registered' });
    }
    
    let user;
    if (isAdmin || role === 'SUPER_ADMIN') {
      user = await Admin.create({ name, email, password, isActive: isActive !== undefined ? isActive : true });
    } else {
      user = await User.create({ 
        name, 
        email, 
        password, 
        isActive: isActive !== undefined ? isActive : true,
        role: role || 'USER',
        organization: organization || null,
        verificationStatus: role === 'ORG_ADMIN' ? 'APPROVED' : 'PENDING'
      });
    }
    
    const userObj = user.toObject();
    delete userObj.password;
    userObj.isAdmin = isAdmin || role === 'SUPER_ADMIN';
    res.status(201).json(userObj);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'This email is already registered to another user' });
    res.status(500).json({ message: err.message });
  }
};

const getSystemConnections = async (req, res) => {
  try {
    const users = await User.find({ connections: { $exists: true, $not: { $size: 0 } } }).populate('connections', 'name email avatar subjects university location studyStyle educationLevel');
    const pairsMap = new Map();
    users.forEach(u => {
      u.connections.forEach(c => {
        const sortedIds = [u._id.toString(), c._id.toString()].sort();
        const key = sortedIds.join('_');
        if (!pairsMap.has(key)) {
          let score = 0;
          if (u.subjects && c.subjects) {
            const shared = u.subjects.filter(s => c.subjects.includes(s));
            score += shared.length * 10;
          }
          if (u.university && c.university && u.university.toLowerCase() === c.university.toLowerCase()) score += 15;
          if (u.location && c.location && u.location.toLowerCase() === c.location.toLowerCase()) score += 5;
          if (u.studyStyle && c.studyStyle && u.studyStyle === c.studyStyle) score += 5;
          if (u.educationLevel && c.educationLevel && u.educationLevel === c.educationLevel) score += 5;

          pairsMap.set(key, { 
            userA: { _id: u._id, name: u.name, email: u.email, avatar: u.avatar }, 
            userB: { _id: c._id, name: c.name, email: c.email, avatar: c.avatar },
            matchScore: score
          });
        }
      });
    });
    res.json(Array.from(pairsMap.values()));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const severSystemConnection = async (req, res) => {
  try {
    const { userA, userB } = req.params;
    await User.findByIdAndUpdate(userA, { $pull: { connections: userB } });
    await User.findByIdAndUpdate(userB, { $pull: { connections: userA } });
    res.json({ message: 'Global connection securely severed.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find().populate('createdBy', 'name email').sort({ name: 1 });
    res.json(subjects);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const createSubject = async (req, res) => {
  try {
    if (!req.body.name) return res.status(400).json({ message: 'Subject name required' });
    const subject = await Subject.create({ name: req.body.name, createdBy: req.user._id });
    res.status(201).json(subject);
  } catch (err) {
    if (err.code === 11000) return res.status(400).json({ message: 'Subject already exists globally.' });
    res.status(500).json({ message: err.message });
  }
};

const deleteSubject = async (req, res) => {
  try {
    await Subject.findByIdAndDelete(req.params.id);
    res.json({ message: 'Subject removed' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getFeedback = async (req, res) => {
  try {
    const feedback = await Feedback.find().populate('user', 'name email avatar').sort({ createdAt: -1 });
    res.json(feedback);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateFeedbackStatus = async (req, res) => {
  try {
    const feedback = await Feedback.findByIdAndUpdate(req.params.id, { status: req.body.status }, { returnDocument: 'after' });
    res.json(feedback);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const broadcastEmail = async (req, res) => {
  try {
    const { subject, message, filters, targetUsers } = req.body;
    if (!subject || !message) return res.status(400).json({ message: 'Subject and message are heavily required.' });

    let query = { isActive: true };
    
    if (filters) {
      if (filters.subject) query.subjects = { $in: [new RegExp(escapeRegex(filters.subject), 'i')] };
      if (filters.educationLevel) query.educationLevel = filters.educationLevel;
      if (filters.location) query.location = new RegExp(escapeRegex(filters.location), 'i');
    }

    let recipients = [];
    if (targetUsers === 'all' || filters) {
      const users = await User.find(query);
      recipients = users.map(u => ({ email: u.email, name: u.name }));
    } else if (Array.isArray(targetUsers) && targetUsers.length > 0) {
      query._id = { $in: targetUsers };
      const users = await User.find(query);
      recipients = users.map(u => ({ email: u.email, name: u.name }));
    } else {
      return res.status(400).json({ message: 'Invalid targetUsers or filters.' });
    }

    const settings = await Settings.findOne() || {};
    const broadcastHtmlTemplate = settings.emailTemplateBroadcast || `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2>Hello {name},</h2>
        <div style="padding: 20px; background: #f9fafb; border-radius: 8px; margin: 20px 0; white-space: pre-wrap;">
          {message}
        </div>
        <p style="color: #6b7280; font-size: 14px;">- The StudyFriend Administrative Team</p>
      </div>
    `;

    await Promise.all(recipients.map(recipient => {
      const htmlContent = broadcastHtmlTemplate.replace(/{name}/g, recipient.name).replace(/{message}/g, message);
      return sendEmail({
        email: recipient.email,
        subject: subject,
        message: `Hello ${recipient.name},\n\n${message}\n\n- Administrative Team`,
        html: htmlContent
      }).catch(err => console.error(`Broadcast failed for ${recipient.email}:`, err));
    }));

    res.json({ message: `Securely broadcasted to ${recipients.length} valid active users.` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getDashboardStats = async (req, res) => {
  try {
    const totalUsers = await User.countDocuments({});
    
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const dau = await User.countDocuments({ lastStudyDate: { $gte: startOfToday } });

    const dropOffs = await User.countDocuments({ $or: [{ subjects: { $size: 0 } }, { studyStyle: { $exists: false } }] });

    const activeSessions = await Session.countDocuments({ status: { $in: ['upcoming', 'ongoing'] } });
    const reports = await Feedback.countDocuments({}); 
    res.json({ totalUsers, dau, dropOffs, activeSessions, reports });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getUserGrowth = async (req, res) => {
  try {
    const growth = await User.aggregate([
      { 
        $group: {
          _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
          users: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } },
      { $limit: 30 }
    ]);
    res.json(growth);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getSessionStats = async (req, res) => {
  try {
    const stats = await Session.aggregate([
      { $group: { _id: "$subject", count: { $sum: 1 }, avgDuration: { $avg: "$duration" } } },
      { $sort: { count: -1 } },
      { $limit: 10 }
    ]);

    const peakHours = await Session.aggregate([
      { $project: { hour: { $hour: "$date" } } },
      { $group: { _id: "$hour", count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);

    res.json({ popularSubjects: stats, peakHours });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getSystemHealth = async (req, res) => {
  try {
    const uptime = process.uptime();
    const dbState = mongoose.connection.readyState;
    
    os.cpuUsage(function(cpuVal) {
      const cpuUsage = (cpuVal * 100).toFixed(2);
      const freeMem = os.freememPercentage() * 100;
      const usedMem = 100 - freeMem;
      
      res.json({ 
        status: 'healthy', 
        uptime, 
        dbState,
        cpuUsage: parseFloat(cpuUsage),
        memoryUsage: parseFloat(usedMem.toFixed(2)),
        totalMem: os.totalmem().toFixed(0)
      });
    });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getSystemConfigs = async (req, res) => {
  try {
    const configs = await SystemConfig.find({});
    res.json(configs);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const saveSystemConfig = async (req, res) => {
  try {
    const { key, value, isActive } = req.body;
    let config = await SystemConfig.findOne({ key });
    if (config) {
      config.value = value;
      config.isActive = isActive !== undefined ? isActive : config.isActive;
      await config.save();
    } else {
      config = await SystemConfig.create({ key, value, isActive: isActive !== undefined ? isActive : true });
    }
    await AuditLog.create({ adminId: req.user._id, action: 'UPDATE_CONFIG', details: `Updated ${key}` });
    res.json(config);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getAuditLogs = async (req, res) => {
  try {
    const logs = await AuditLog.find({}).populate('adminId', 'name email').populate('targetId', 'name email').sort({ createdAt: -1 }).limit(100);
    res.json(logs);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const bulkActionUsers = async (req, res) => {
  try {
    const { userIds, action } = req.body;
    if (!userIds || !userIds.length || !action) return res.status(400).json({ message: 'Missing userIds or action' });
    
    if (action === 'block') {
      await User.updateMany({ _id: { $in: userIds } }, { isActive: false });
      await AuditLog.create({ adminId: req.user._id, action: 'BULK_BLOCK_USERS', details: `Blocked ${userIds.length} users` });
    } else if (action === 'delete') {
      await User.deleteMany({ _id: { $in: userIds } });
      await AuditLog.create({ adminId: req.user._id, action: 'BULK_DELETE_USERS', details: `Deleted ${userIds.length} users` });
    }

    res.json({ message: `Successfully executed ${action} on users.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getReports = async (req, res) => {
  try {
    const reports = await Report.find({})
      .populate('reporterId',     'name email avatar trustStrikes isShadowBanned')
      .populate('reportedUserId', 'name email avatar trustStrikes isShadowBanned')
      .populate('sessionId',      'title subject')
      .sort({ createdAt: -1 })
      .limit(200);
    res.json(reports);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateReport = async (req, res) => {
  try {
    const report = await Report.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!report) return res.status(404).json({ message: 'Report not found' });
    await AuditLog.create({ adminId: req.user._id, action: 'REVIEW_REPORT', details: `Marked report ${req.params.id} as ${req.body.status}` });
    res.json(report);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── Lift a shadowban (clear strikes + unban) ─────────────────────────────
const liftShadowBan = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isShadowBanned: false, trustStrikes: 0 },
      { new: true, select: 'name email trustStrikes isShadowBanned' }
    );
    if (!user) return res.status(404).json({ message: 'User not found' });
    await AuditLog.create({ adminId: req.user._id, action: 'LIFT_SHADOWBAN', details: `Lifted shadowban from ${user.name} (${user.email}) and reset strikes to 0` });
    res.json({ message: `Shadowban lifted and strikes reset for ${user.name}.`, user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── Get all shadowbanned users ───────────────────────────────────────────
const getShadowBannedUsers = async (req, res) => {
  try {
    const users = await User.find({ isShadowBanned: true })
      .select('name email avatar trustStrikes isShadowBanned createdAt')
      .sort({ trustStrikes: -1 })
      .lean();
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const scanContent = async (req, res) => {
  try {
    const badWords = ['spam', 'abuse', 'offensive', 'scam', 'fake', 'hate', 'slur'];
    const regex = new RegExp(`\\b(${badWords.join('|')})\\b`, 'i');
    const flaggedUsers = await User.find({ bio: { $regex: regex } }).select('name email bio');
    
    for (const u of flaggedUsers) {
      const exists = await FlaggedItem.findOne({ author: u._id, source: 'Profile Bio' });
      if (!exists) {
        await FlaggedItem.create({ author: u._id, originalText: u.bio, source: 'Profile Bio' });
      }
    }

    const flags = await FlaggedItem.find({ status: 'pending' }).populate('author', 'name email avatar').populate('recipient', 'name email').sort({ createdAt: -1 }).limit(100);
    res.json(flags);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const updateFlaggedItem = async (req, res) => {
  try {
    const item = await FlaggedItem.findByIdAndUpdate(req.params.id, { status: req.body.status }, { returnDocument: 'after' });
    res.json(item);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getGamificationLeaderboard = async (req, res) => {
  try {
    const users = await User.find({ isActive: true })
      .sort({ xp: -1, level: -1 })
      .limit(50)
      .select('name email avatar xp level badges streak');
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const awardBadge = async (req, res) => {
  try {
    const { userId, badge } = req.body;
    if (!userId || !badge) return res.status(400).json({ message: 'User ID and badge name are required' });
    const user = await User.findById(userId);
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    if (!user.badges) user.badges = [];
    if (!user.badges.includes(badge)) {
      user.badges.push(badge);
      // Give them a bonus 500 XP for earning a badge from an admin
      if (typeof user.xp !== 'number' || isNaN(user.xp)) user.xp = 0;
      user.xp += 500;
      user.level = Math.floor(user.xp / 1000) + 1;
      await user.save();
      if (req.user && req.user._id) {
         await AuditLog.create({ adminId: req.user._id, action: 'AWARD_BADGE', details: `Awarded ${badge} to ${user.name}` });
      }
    }
    
    res.json({ message: 'Badge awarded successfully', user });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── ORG ADMIN CONTROLLERS ── //
const getPendingUsers = async (req, res) => {
  try {
    const query = { verificationStatus: 'PENDING' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    
    // Super Admins pull the entire network's pending queue, populated with the Institution name
    const users = await User.find(query)
      .populate('organization', 'name domain')
      .select('-password')
      .lean();
      
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const approveUser = async (req, res) => {
  try {
    const query = { _id: req.params.id, verificationStatus: 'PENDING' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    
    const user = await User.findOneAndUpdate(
      query,
      { verificationStatus: 'APPROVED' },
      { returnDocument: 'after' }
    ).select('-password');
    
    if (!user) return res.status(404).json({ message: 'Pending user not found or unauthorized.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const rejectUser = async (req, res) => {
  try {
    const query = { _id: req.params.id, verificationStatus: 'PENDING' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    
    const user = await User.findOneAndUpdate(
      query,
      { verificationStatus: 'REJECTED' },
      { returnDocument: 'after' }
    ).select('-password');
    
    if (!user) return res.status(404).json({ message: 'Pending user not found or unauthorized.' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getOrgUsers = async (req, res) => {
  try {
    const query = { verificationStatus: 'APPROVED' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    const users = await User.find(query)
      .populate('organization', 'name domain')
      .select('-password')
      .lean();
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const toggleOrgUserStatus = async (req, res) => {
  try {
    const query = { _id: req.params.id, verificationStatus: 'APPROVED' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    const user = await User.findOne(query);
    if (!user) return res.status(404).json({ message: 'User not found or unauthorized' });
    
    user.isActive = !user.isActive;
    await user.save();
    
    const safeUser = user.toObject();
    delete safeUser.password;
    res.json(safeUser);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteOrgUser = async (req, res) => {
  try {
    const query = { _id: req.params.id, verificationStatus: 'APPROVED' };
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    const user = await User.findOneAndDelete(query);
    if (!user) return res.status(404).json({ message: 'User not found or unauthorized' });
    
    res.json({ message: 'Student successfully expelled from the Institution network.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getOrgDashboardStats = async (req, res) => {
  try {
    const query = {};
    if (!req.user.isAdmin && req.user.role !== 'admin') {
      query.organization = req.user.organization;
    }
    
    const pendingRequests = await User.countDocuments({ ...query, verificationStatus: 'PENDING' });
    const totalStudents = await User.countDocuments({ ...query, verificationStatus: 'APPROVED' });
    const activeStudents = await User.countDocuments({ ...query, verificationStatus: 'APPROVED', isActive: true });
    const suspendedStudents = await User.countDocuments({ ...query, verificationStatus: 'APPROVED', isActive: false });
    
    res.json({ pendingRequests, totalStudents, activeStudents, suspendedStudents });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── GLOBAL GOD-MODE CONTROLLERS ── //
const getGlobalOrganizations = async (req, res) => {
  try {
    const orgs = await Organization.find({}).lean();
    
    // Attach student metrics to each org via aggregation locally
    for (let org of orgs) {
      org.totalStudents = await User.countDocuments({ organization: org._id, verificationStatus: 'APPROVED' });
      org.pendingStudents = await User.countDocuments({ organization: org._id, verificationStatus: 'PENDING' });
    }
    res.json(orgs);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const createOrganization = async (req, res) => {
  try {
    const { name, domain, authorizedAdmins } = req.body;
    if (!name || !domain) return res.status(400).json({ message: 'Name and Domain are strictly required.' });
    
    const exists = await Organization.findOne({ domain });
    if (exists) return res.status(400).json({ message: 'Organization domain already registered.' });
    
    let parsedAdmins = [];
    if (authorizedAdmins) {
      if (typeof authorizedAdmins === 'string') {
        parsedAdmins = authorizedAdmins.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
      } else if (Array.isArray(authorizedAdmins)) {
        parsedAdmins = authorizedAdmins.map(a => a.toLowerCase().trim());
      }
    }

    const org = await Organization.create({ name, domain, authorizedAdmins: parsedAdmins });
    await AuditLog.create({ adminId: req.user._id, action: 'CREATE_ORG', details: `Created organization ${name} (${domain})` });
    res.status(201).json(org);
  } catch (err) { 
    console.error('ORG CREATION ERROR:', err);
    res.status(500).json({ message: err.message }); 
  }
};

const updateOrganization = async (req, res) => {
  try {
    const { name, domain, authorizedAdmins } = req.body;
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    
    if (name) org.name = name;
    if (domain) org.domain = domain;
    if (authorizedAdmins !== undefined) {
      let parsedAdmins = [];
      if (typeof authorizedAdmins === 'string') {
        parsedAdmins = authorizedAdmins.split(',').map(a => a.trim().toLowerCase()).filter(Boolean);
      } else if (Array.isArray(authorizedAdmins)) {
        parsedAdmins = authorizedAdmins.map(a => a.toLowerCase().trim());
      }
      org.authorizedAdmins = parsedAdmins;
    }
    
    await org.save();
    await AuditLog.create({ adminId: req.user._id, action: 'UPDATE_ORG', details: `Updated organization ${org.name}` });
    res.json(org);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const deleteOrganization = async (req, res) => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) return res.status(404).json({ message: 'Organization not found' });
    
    const usersCount = await User.countDocuments({ organization: org._id });
    if (usersCount > 50) {
      return res.status(400).json({ message: `Safety Lock Active: Cannot wipe a heavily-populated Walled Garden (${usersCount} users). Manually expel students first.` });
    }
    
    if (usersCount > 0) {
      // Automatically sever ties for small test organizations
      await User.updateMany(
        { organization: org._id }, 
        { $set: { organization: null, role: 'USER', verificationStatus: 'PENDING' } }
      );
    }
    
    await Organization.findByIdAndDelete(req.params.id);
    await AuditLog.create({ adminId: req.user._id, action: 'DELETE_ORG', details: `Erased organization ${org.name}` });
    res.json({ message: 'Organization permanently deleted.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getGlobalPendingUsers = async (req, res) => {
  try {
    const users = await User.find({ verificationStatus: 'PENDING' })
      .populate('organization', 'name domain')
      .select('-password')
      .lean();
    res.json(users);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

// ── SQUAD OVERSIGHT & GAMIFICATION ── //

const getGlobalSquads = async (req, res) => {
  try {
    const squads = await StudyGroup.find({}).populate('creator', 'name email').populate('members', 'name email').lean();
    res.json(squads);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const disbandSquad = async (req, res) => {
  try {
    const squad = await StudyGroup.findById(req.params.id);
    if (!squad) return res.status(404).json({ message: 'Squad not found' });
    
    await StudyGroup.findByIdAndDelete(req.params.id);
    await AuditLog.create({ adminId: req.user._id, action: 'DISBAND_SQUAD', details: `Severed Squad: ${squad.name}` });
    res.json({ message: 'Squad forced disbanded globally.' });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getGlobalQuests = async (req, res) => {
  try {
    const distinctTaskNames = await DailyQuest.distinct('task', { isCompleted: false });
    // Aggregation could be used, but unique string pulling is extremely fast.
    res.json(distinctTaskNames.map((task, i) => ({ _id: `q_${i}`, task, isActive: true })));
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const injectQuest = async (req, res) => {
  try {
    const { task } = req.body;
    if (!task) return res.status(400).json({ message: 'Task string required.' });
    
    // Inject quest directly into every functional user instance.
    const users = await User.find({ isActive: true }).select('_id');
    const questsToInsert = users.map(u => ({ userId: u._id, task, progress: 0, isCompleted: false }));
    
    await DailyQuest.insertMany(questsToInsert);
    await AuditLog.create({ adminId: req.user._id, action: 'INJECT_QUEST', details: `Injected massive global quest: ${task}` });
    
    res.status(201).json({ message: `Securely injected quest to ${users.length} users.` });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

module.exports = { 
  getUsers, updateUser, deleteUser, createUser, 
  getSystemConnections, severSystemConnection, 
  getSubjects, createSubject, deleteSubject, 
  getFeedback, updateFeedbackStatus, broadcastEmail,
  getDashboardStats, getUserGrowth, getSessionStats, getSystemHealth,
  getSystemConfigs, saveSystemConfig, getAuditLogs, bulkActionUsers,
  getReports, updateReport, liftShadowBan, getShadowBannedUsers,
  scanContent, updateFlaggedItem,
  getGamificationLeaderboard, awardBadge,
  getPendingUsers, approveUser, rejectUser,
  getOrgUsers, toggleOrgUserStatus, deleteOrgUser, getOrgDashboardStats,
  getGlobalOrganizations, createOrganization, updateOrganization, deleteOrganization,
  getGlobalPendingUsers,
  getGlobalSquads, disbandSquad, getGlobalQuests, injectQuest
};
