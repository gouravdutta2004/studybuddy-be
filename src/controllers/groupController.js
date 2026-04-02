const StudyGroup = require('../models/StudyGroup');

const getGroups = async (req, res) => {
  try {
    const { subject, search } = req.query;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = { isPublic: true };
    if (subject) query.subject = new RegExp(escapeRegex(subject), 'i');
    if (search) query.name = new RegExp(escapeRegex(search), 'i');

    const groups = await StudyGroup.find(query)
      .populate('creator', 'name avatar')
      .sort({ createdAt: -1 });
    res.json(groups);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const createGroup = async (req, res) => {
  try {
    const { name, description, subject, maxMembers, isPublic } = req.body;
    
    const plan = req.user.subscription?.plan || 'basic';
    let finalIsPublic = isPublic !== undefined ? isPublic : true;
    
    if (plan === 'basic' && finalIsPublic === false) {
      return res.status(403).json({ message: 'Free plan can only create public squads. Upgrade to Pro for private squads!' });
    }
    
    const planLimits = { basic: 10, pro: 20, squad: 50 };
    const limit = planLimits[plan] || 10;
    
    let finalMaxMembers = parseInt(maxMembers) || limit;
    if (finalMaxMembers > limit) {
      return res.status(403).json({ message: `Your ${plan.toUpperCase()} plan allows a maximum of ${limit} members per squad.` });
    }
    
    const group = await StudyGroup.create({
      name, description, subject, maxMembers: finalMaxMembers,
      isPublic: finalIsPublic,
      creator: req.user._id,
      members: [req.user._id]
    });
    const ActivityLog = require('../models/ActivityLog');
    await ActivityLog.create({
      type: 'general',
      description: `New squad formed: "${name}"`,
      userId: req.user._id,
      groupId: group._id
    });
    res.status(201).json(group);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const joinGroup = async (req, res) => {
  try {
    const group = await StudyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    if (group.members.includes(req.user._id))
      return res.status(400).json({ message: 'Already a member' });
    if (group.members.length >= group.maxMembers)
      return res.status(400).json({ message: 'Group is full' });

    group.members.push(req.user._id);
    await group.save();
    
    const ActivityLog = require('../models/ActivityLog');
    await ActivityLog.create({
      type: 'general',
      description: `Joined the squad: "${group.name}"`,
      userId: req.user._id,
      groupId: group._id
    });
    
    res.json({ message: 'Joined group successfully', group });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const leaveGroup = async (req, res) => {
  try {
    const group = await StudyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    
    group.members = group.members.filter(m => m.toString() !== req.user._id.toString());
    await group.save();
    res.json({ message: 'Left group successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getGroupQuickPeek = async (req, res) => {
  try {
    const group = await StudyGroup.findById(req.params.id)
      .select('name subject maxMembers members')
      .populate('members', 'name avatar');
    if (!group) return res.status(404).json({ message: 'Group not found' });
    
    // Attempt to find a next session by matching subject
    const Session = require('../models/Session');
    const nextSession = await Session.findOne({ 
      subject: group.subject,
      startTime: { $gt: new Date() }
    }).sort({ startTime: 1 }).select('startTime');

    res.json({
      _id: group._id, name: group.name, subject: group.subject,
      memberCount: group.members.length, maxMembers: group.maxMembers,
      members: group.members.slice(0, 5), // Return up to 5 members
      nextSession: nextSession ? nextSession.startTime : null
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateGroupKanban = async (req, res) => {
  try {
    const { kanbanTasks } = req.body;
    const group = await StudyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    group.kanbanTasks = kanbanTasks;
    await group.save();
    res.json(group.kanbanTasks);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const uploadGroupResource = async (req, res) => {
  try {
    const { id, type, url, title } = req.body;
    const group = await StudyGroup.findById(req.params.id);
    if (!group) return res.status(404).json({ message: 'Group not found' });
    
    const User = require('../models/User');
    const creatorUser = await User.findById(group.creator);
    const creatorPlan = creatorUser?.subscription?.plan || 'basic';
    
    if (creatorPlan !== 'squad' && group.resources.length >= 5) {
      return res.status(403).json({ message: 'Squad vault limit reached (5 items). The Squad creator needs the Squad plan for unlimited storage!' });
    }
    
    const newResource = { id, type, url, title, uploadedBy: req.user._id };
    group.resources.push(newResource);
    await group.save();
    
    // Auto-create an activity log for resource upload
    const ActivityLog = require('../models/ActivityLog');
    await ActivityLog.create({
      type: 'general',
      description: `New resource "${title}" shared in squad`,
      userId: req.user._id,
      groupId: group._id
    });

    res.status(201).json(newResource);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getGroups, createGroup, joinGroup, leaveGroup, getGroupQuickPeek, updateGroupKanban, uploadGroupResource };
