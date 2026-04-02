const User = require('../models/User');
const Admin = require('../models/Admin');
const Feedback = require('../models/Feedback');
const Subject = require('../models/Subject');
const sendEmail = require('../utils/sendEmail');
const { sendPushToUser } = require('../utils/pushNotification');

const getProfile = async (req, res) => {
  try {
    let user = await User.findById(req.params.id).populate('connections', 'name avatar subjects university');
    
    if (!user) {
      user = await Admin.findById(req.params.id);
      if (user) {
        user = user.toJSON();
        user.isAdmin = true;
      }
    }
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMyProfile = async (req, res) => {
  try {
    let user = await User.findById(req.user.id).populate('connections', 'name avatar subjects university');
    
    if (!user) {
      user = await Admin.findById(req.user.id);
      if (user) {
        user = user.toJSON();
        user.isAdmin = true;
      }
    }
    
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json(user);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password');
    if (!user) return res.status(404).json({ message: 'User not found' });

    const fields = ['name', 'bio', 'avatar', 'subjects', 'educationLevel', 'university', 'location', 'studyStyle', 'availability', 'preferOnline', 'socialLinks', 'timezone', 'weeklyGoals'];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        user[f] = req.body[f];
      }
    });

    if (user.socialLinks) {
      let count = 0;
      if (user.socialLinks.github?.trim()) count++;
      if (user.socialLinks.linkedin?.trim()) count++;
      if (user.socialLinks.instagram?.trim()) count++;
      user.isVerified = count >= 2;
    }

    const updatedUser = await user.save();
    res.json(updatedUser);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const searchUsers = async (req, res) => {
  try {
    const { subject, location, educationLevel, studyStyle, name } = req.query;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = { _id: { $ne: req.user._id }, isActive: true, isAdmin: { $ne: true } };
    if (subject) query.subjects = { $in: [new RegExp(escapeRegex(subject), 'i')] };
    if (location) query.location = new RegExp(escapeRegex(location), 'i');
    if (educationLevel) query.educationLevel = educationLevel;
    if (studyStyle) query.studyStyle = studyStyle;
    if (name) query.name = new RegExp(escapeRegex(name), 'i');
    const users = await User.find(query).select('-password').limit(50);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMatches = async (req, res) => {
  try {
    const me = await User.findById(req.user._id);
    if (!me) return res.json([]); // Graceful fallback for Admin tokens accessing user matches
    const excluded = [
      me._id, 
      ...me.connections, 
      ...me.sentRequests, 
      ...me.pendingRequests,
      ...(me.skippedMatches || [])
    ];
    
    // Fetch all active potential matches
    const query = {
      _id: { $ne: req.user._id, $nin: excluded },
      isActive: true,
      isAdmin: { $ne: true }
    };

    // Walled Garden Entity Isolation
    if (me.organization) {
      query.organization = me.organization;
    }

    const candidates = await User.find(query).select('-password').lean();

    // Scoring Engine
    const scoredMatches = candidates.map(c => {
      let score = 0;
      
      // +40% for shared subjects
      if (me.subjects && c.subjects && me.subjects.length > 0) {
        const sharedSubjects = me.subjects.filter(s => c.subjects.includes(s));
        if (sharedSubjects.length > 0) {
           // Provide up to 40% proportional to shared subjects, or flat 40 if 100% matched
           score += Math.min(40, (sharedSubjects.length / me.subjects.length) * 40);
        }
      }
      
      // +30% for same major
      if (me.major && c.major && me.major.trim() !== '' && me.major.toLowerCase().trim() === c.major.toLowerCase().trim()) {
        score += 30;
      }
      
      // +30% for overlapping schedules
      if (me.availability && me.availability.length > 0 && c.availability && c.availability.length > 0) {
        let overlapFound = false;
        me.availability.forEach(mAvail => {
            const hasMatch = c.availability.find(cAvail => cAvail.day === mAvail.day);
            if (hasMatch) {
              overlapFound = true;
            }
        });
        if (overlapFound) score += 30;
      }
      
      return { ...c, matchScore: Math.round(score), matchPercentage: Math.round(score) };
    });

    const filteredAndSorted = scoredMatches
      .filter(c => c.matchScore > 0)
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 20);

    res.json(filteredAndSorted);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const skipMatch = async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.user._id.toString())
      return res.status(400).json({ message: 'Cannot skip yourself' });
    
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { skippedMatches: userId } });
    res.json({ message: 'User skipped successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const sendRequest = async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.user._id.toString())
      return res.status(400).json({ message: 'Cannot connect with yourself' });
      
    if (req.user.subscription?.plan === 'basic' && req.user.connections.length >= 3) {
      return res.status(403).json({ message: 'Free plan allows a maximum of 3 connections. Upgrade to Pro for unlimited connections!' });
    }
    
    const target = await User.findById(userId);
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (req.user.connections.includes(userId))
      return res.status(400).json({ message: 'Already connected' });
    if (req.user.sentRequests.includes(userId))
      return res.status(400).json({ message: 'Request already sent' });
    await User.findByIdAndUpdate(req.user._id, { $addToSet: { sentRequests: userId } });
    await User.findByIdAndUpdate(userId, { $addToSet: { pendingRequests: req.user._id } });

    try {
      const io = req.app.get('io');
      if (io) {
        io.to(userId).emit('notification', { message: `New connection request from ${req.user.name}` });
      }
      // Browser push notification
      await sendPushToUser(userId, {
        title: '📨 New Connection Request',
        body: `${req.user.name} wants to connect with you on StudyFriend!`,
        icon: '/icons.svg',
        url: '/connections'
      });
      await sendEmail({
        email: target.email,
        subject: 'New StudyFriend Request!',
        message: `Hello ${target.name},\n\nYou have a new connection request from ${req.user.name}.\nLog into StudyFriend to accept or decline the request!\n\nBest,\nThe StudyFriend Team`
      });
    } catch (err) {
      console.error('Email/Notification failed to send but request was dispatched:', err);
    }

    res.json({ message: 'Connection request sent' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const acceptRequest = async (req, res) => {
  try {
    const { userId } = req.params;
    if (!req.user.pendingRequests.includes(userId))
      return res.status(400).json({ message: 'No pending request from this user' });
      
    if (req.user.subscription?.plan === 'basic' && req.user.connections.length >= 3) {
      return res.status(403).json({ message: 'Free plan allows a maximum of 3 connections. Upgrade to Pro to accept more connections!' });
    }
    
    await User.findByIdAndUpdate(req.user._id, {
      $addToSet: { connections: userId },
      $pull: { pendingRequests: userId }
    });
    await User.findByIdAndUpdate(userId, {
      $addToSet: { connections: req.user._id },
      $pull: { sentRequests: req.user._id }
    });

    const targetUser = await User.findById(userId);
    if (targetUser) {
      try {
        const io = req.app.get('io');
        if (io) {
          io.to(userId).emit('notification', { message: `${req.user.name} accepted your connection request!` });
        }
        // Browser push notification
        await sendPushToUser(userId, {
          title: '🎉 Connection Accepted!',
          body: `${req.user.name} accepted your connection request. You can now message each other!`,
          icon: '/icons.svg',
          url: '/connections'
        });
        await sendEmail({
          email: targetUser.email,
          subject: 'Connection Request Accepted!',
          message: `Hello ${targetUser.name},\n\nGreat news! ${req.user.name} has accepted your connection request.\nYou can now message each other on StudyFriend!\n\nBest,\nThe StudyFriend Team`
        });
      } catch (err) {
        console.error('Email/Notification failed to send but connection was formed:', err);
      }
    }

    res.json({ message: 'Connection accepted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const rejectRequest = async (req, res) => {
  try {
    const { userId } = req.params;
    await User.findByIdAndUpdate(req.user._id, { $pull: { pendingRequests: userId } });
    await User.findByIdAndUpdate(userId, { $pull: { sentRequests: req.user._id } });
    res.json({ message: 'Request rejected' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getConnections = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('connections', 'name avatar subjects university location')
      .populate('pendingRequests', 'name avatar subjects university')
      .populate('sentRequests', 'name avatar subjects university');
      
    if (!user) {
      return res.json({ connections: [], pendingRequests: [], sentRequests: [] });
    }

    res.json({
      connections: user.connections,
      pendingRequests: user.pendingRequests,
      sentRequests: user.sentRequests
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const disconnectUser = async (req, res) => {
  try {
    const { userId } = req.params;
    await User.findByIdAndUpdate(req.user._id, { $pull: { connections: userId } });
    await User.findByIdAndUpdate(userId, { $pull: { connections: req.user._id } });
    res.json({ message: 'Disconnected successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const submitFeedback = async (req, res) => {
  try {
    const { type, content } = req.body;
    if (!type || !content) return res.status(400).json({ message: 'Type and content required' });
    const feedback = await Feedback.create({ user: req.user._id, type, content });
    res.status(201).json({ message: 'Feedback submitted successfully', feedback });
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getPublicSubjects = async (req, res) => {
  try {
    const subjects = await Subject.find({ isActive: true }).sort({ name: 1 });
    res.json(subjects);
  } catch (err) { res.status(500).json({ message: err.message }); }
};

const getSupportAdmin = async (req, res) => {
  try {
    const admin = await Admin.findOne({ isActive: true }).select('_id');
    if (!admin) return res.status(404).json({ message: 'No active support administrators' });
    res.json({ _id: admin._id });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const logStudy = async (req, res) => {
  try {
    const { minutes } = req.body;
    if (!minutes) return res.status(400).json({ message: 'Minutes required' });
    const user = await User.findById(req.user._id);
    
    // Update study hours
    user.studyHours = (user.studyHours || 0) + (minutes / 60);
    
    // Update streak (simple logic)
    const now = new Date();
    const last = user.lastStudyDate ? new Date(user.lastStudyDate) : null;
    const todayStart = new Date(now).setHours(0, 0, 0, 0);
    const lastStart = last ? new Date(last).setHours(0, 0, 0, 0) : null;
    const oneDayMs = 86400000;

    if (!lastStart || todayStart > lastStart + oneDayMs) {
      user.streak = 1;
    } else if (todayStart > lastStart) {
      user.streak += 1;
    }
    
    user.lastStudyDate = new Date();
    
    // Evaluate badges
    const badges = new Set(user.badges || []);
    if (user.studyHours >= 10) badges.add('10h Scholar');
    if (user.studyHours >= 50) badges.add('50h Master');
    if (user.streak >= 7) badges.add('7-Day Streak');
    user.badges = Array.from(badges);

    await user.save();
    res.json({ message: 'Study time logged', user });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getLeaderboard = async (req, res) => {
  try {
    const users = await User.find({ isActive: true, isAdmin: { $ne: true } })
      .select('name avatar studyHours streak badges xp level')
      .sort({ xp: -1, studyHours: -1 }) // Sort top XP
      .limit(20);
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getQuickPeek = async (req, res) => {
  try {
    const user = await User.findById(req.params.id)
      .select('name avatar subjects lastStudyDate level xp isActive');
    if (!user) return res.status(404).json({ message: 'User not found' });
    
    // Online if active within last 30 minutes
    const isOnline = user.lastStudyDate && (new Date() - new Date(user.lastStudyDate) < 30 * 60 * 1000);
    
    // Calculate mutual subjects
    const currentUser = await User.findById(req.user._id).select('subjects');
    const mutualSubjects = (user.subjects || []).filter(s => (currentUser.subjects || []).includes(s));
    
    // Calculate average rating
    const Rating = require('../models/Rating');
    const ratings = await Rating.find({ targetUser: user._id });
    const avgRating = ratings.length ? (ratings.reduce((acc, r) => acc + r.score, 0) / ratings.length).toFixed(1) : 'New';

    res.json({
      _id: user._id, name: user.name, avatar: user.avatar, level: user.level || 1,
      isOnline, mutualSubjects, avgRating, isActive: user.isActive
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const syncGithub = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user.socialLinks || !user.socialLinks.github) {
      return res.status(400).json({ message: 'GitHub username not linked prior to sync' });
    }
    const username = user.socialLinks.github.trim();
    // Native node 18+ fetch
    const response = await fetch(`https://api.github.com/users/${username}/events/public`);
    if (!response.ok) return res.status(400).json({ message: 'Failed to access remote GitHub history' });
    
    const events = await response.json();
    const dates = events.map(e => new Date(e.created_at));
    
    // Merge dates securely limits massive array overhead
    user.activityLog = [...(user.activityLog || []), ...dates].slice(-500); 
    await user.save();
    
    res.json({ message: 'GitHub coordinates synched deeply into heatmap!', activityLog: user.activityLog });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const updateLocation = async (req, res) => {
  try {
    const { lat, lng } = req.body;
    if (lat === undefined || lng === undefined) {
      return res.status(400).json({ message: 'lat and lng are required' });
    }
    await User.findByIdAndUpdate(req.user._id, {
      geoLocation: { type: 'Point', coordinates: [parseFloat(lng), parseFloat(lat)] }
    });
    res.json({ message: 'Location updated' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getNearbyUsers = async (req, res) => {
  try {
    const { lat, lng, radius = 10000 } = req.query; // radius in metres, default 10km
    if (!lat || !lng) return res.status(400).json({ message: 'lat and lng are required' });

    const latF = parseFloat(lat);
    const lngF = parseFloat(lng);
    const radiusM = parseInt(radius);

    let users = [];

    try {
      // Primary: $near — requires 2dsphere index (fast, sorted by distance)
      users = await User.find({
        _id: { $ne: req.user._id },
        isActive: true,
        isAdmin: { $ne: true },
        geoLocation: {
          $near: {
            $geometry: { type: 'Point', coordinates: [lngF, latF] },
            $maxDistance: radiusM
          }
        }
      }).select('name avatar subjects university level xp studyStyle geoLocation').limit(50);
    } catch (geoErr) {
      // Fallback: $geoWithin $centerSphere — works even without a 2dsphere index
      console.warn('$near failed, falling back to $geoWithin:', geoErr.message);
      const radiusRad = radiusM / 6378100; // convert metres to radians (Earth radius ~6378.1km)
      users = await User.find({
        _id: { $ne: req.user._id },
        isActive: true,
        isAdmin: { $ne: true },
        'geoLocation.coordinates': {
          $geoWithin: { $centerSphere: [[lngF, latF], radiusRad] }
        }
      }).select('name avatar subjects university level xp studyStyle geoLocation').limit(50);
    }

    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};



const getMyAnalytics = async (req, res) => {
  try {
    const Session = require('../models/Session');
    const StudyMetric = require('../models/StudyMetric');

    const userId = req.user._id;
    const user = await User.findById(userId).select('connections streak badges xp level activityLog totalStudyHours studyHours subjects');
    if (!user) return res.status(404).json({ message: 'User not found' });

    // Last 30 days date range
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Last 8 weeks date range
    const eightWeeksAgo = new Date();
    eightWeeksAgo.setDate(eightWeeksAgo.getDate() - 56);

    // Sessions completed (participated or hosted) per week for last 8 weeks
    const allMySessions = await Session.find({
      $or: [{ host: userId }, { participants: userId }],
      createdAt: { $gte: eightWeeksAgo }
    }).select('scheduledAt subject status');

    // Group sessions by ISO week
    const weekMap = {};
    for (let i = 7; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - (i * 7));
      const weekLabel = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString('default', { month: 'short' })}`;
      weekMap[weekLabel] = { week: weekLabel, sessions: 0 };
    }
    allMySessions.forEach(s => {
      const d = new Date(s.scheduledAt);
      const weekLabel = `W${Math.ceil(d.getDate() / 7)} ${d.toLocaleString('default', { month: 'short' })}`;
      if (weekMap[weekLabel]) weekMap[weekLabel].sessions++;
    });
    const sessionsByWeek = Object.values(weekMap);

    // Study hours per day for last 30 days from StudyMetric
    const metrics = await StudyMetric.find({
      userId,
      date: { $gte: thirtyDaysAgo }
    }).sort({ date: 1 });
    const hoursByDay = metrics.map(m => ({
      date: m.date.toISOString().split('T')[0],
      hours: parseFloat((m.hours || 0).toFixed(2))
    }));

    // Top subjects by session count
    const subjectMap = {};
    allMySessions.forEach(s => {
      if (s.subject) subjectMap[s.subject] = (subjectMap[s.subject] || 0) + 1;
    });
    const topSubjects = Object.entries(subjectMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, value]) => ({ name, value }));

    res.json({
      totalStudyHours: parseFloat((user.studyHours || user.totalStudyHours || 0).toFixed(1)),
      streak: user.streak || 0,
      badgeCount: (user.badges || []).length,
      connectionCount: (user.connections || []).length,
      xp: user.xp || 0,
      level: user.level || 1,
      sessionsByWeek,
      hoursByDay,
      topSubjects,
      activityLog: (user.activityLog || []).slice(-365)
    });
  } catch (err) {
    console.error('Analytics Error:', err.message);
    res.status(500).json({ message: err.message });
  }
};

module.exports = { getProfile, updateProfile, searchUsers, getMatches, skipMatch, sendRequest, acceptRequest, rejectRequest, getConnections, disconnectUser, submitFeedback, getPublicSubjects, getSupportAdmin, logStudy, getLeaderboard, getQuickPeek, syncGithub, updateLocation, getNearbyUsers, getMyProfile, getMyAnalytics };
