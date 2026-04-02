const Session = require('../models/Session');
const { checkAndCompleteQuest } = require('../utils/questEngine');

const createSession = async (req, res) => {
  try {
    const { title, description, subject, scheduledAt, duration, isOnline, meetingLink, location, maxParticipants, recurrence } = req.body;
    const session = await Session.create({
      title, description, subject, scheduledAt, duration, isOnline, meetingLink, location, maxParticipants, recurrence: recurrence || 'NONE',
      host: req.user._id,
      participants: [req.user._id]
    });
    await session.populate('host', 'name avatar');
    
    // Auto-complete quest
    const io = req.app.get('io');
    checkAndCompleteQuest(req.user._id, 'CREATE_SESSION', io).catch(() => {});
    
    if (recurrence === 'WEEKLY') {
      const clonedSessions = [];
      const baseDate = new Date(scheduledAt);
      for (let i = 1; i <= 4; i++) {
        const nextDate = new Date(baseDate.getTime() + (i * 7 * 24 * 60 * 60 * 1000));
        clonedSessions.push({
          title, description, subject, scheduledAt: nextDate, duration, isOnline, meetingLink, location, maxParticipants, recurrence: 'WEEKLY',
          host: req.user._id,
          participants: [req.user._id]
        });
      }
      await Session.insertMany(clonedSessions);
    }
    
    res.status(201).json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSessions = async (req, res) => {
  try {
    const { subject, status } = req.query;
    const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const query = { status: status || 'upcoming' };
    if (subject) query.subject = new RegExp(escapeRegex(subject), 'i');
    const sessions = await Session.find(query)
      .populate('host', 'name avatar university')
      .populate('participants', 'name avatar')
      .sort({ scheduledAt: 1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getMySessions = async (req, res) => {
  try {
    const sessions = await Session.find({
      $or: [{ host: req.user._id }, { participants: req.user._id }]
    })
      .populate('host', 'name avatar')
      .populate('participants', 'name avatar')
      .sort({ scheduledAt: 1 });
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getSessionById = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id)
      .populate('host', 'name avatar')
      .populate('participants', 'name avatar');
    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const joinSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    // Already a participant — just return success (idempotent join)
    if (session.participants.map(p => p.toString()).includes(req.user._id.toString())) {
      return res.json({ message: 'Already joined', alreadyMember: true });
    }
    if (session.participants.length >= session.maxParticipants)
      return res.status(400).json({ message: 'Session is full' });
    session.participants.push(req.user._id);
    await session.save();
    
    // Auto-complete quest & notify host via socket
    const io = req.app.get('io');
    checkAndCompleteQuest(req.user._id, 'JOIN_SESSION', io).catch(() => {});
    
    if (io && session.host.toString() !== req.user._id.toString()) {
      io.to(session.host.toString()).emit('notification', { 
        message: `${req.user.name} joined your session: ${session.title}` 
      });
    }

    res.json({ message: 'Joined session successfully' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const leaveSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    session.participants = session.participants.filter(p => p.toString() !== req.user._id.toString());
    await session.save();
    res.json({ message: 'Left session' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const deleteSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (session.host.toString() !== req.user._id.toString())
      return res.status(403).json({ message: 'Not authorized' });
    await session.deleteOne();
    res.json({ message: 'Session deleted' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const addNote = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    if (!session.participants.map(p => p.toString()).includes(req.user._id.toString()) && session.host.toString() !== req.user._id.toString()) {
      return res.status(403).json({ message: 'Not authorized to add notes to this session' });
    }
    
    session.notes.push({
      url: req.body.url,
      name: req.body.name,
      uploadedBy: req.user.name
    });
    
    await session.save();
    res.json(session.notes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const rsvpSession = async (req, res) => {
  try {
    const { status } = req.body; // 'ATTENDING', 'PENDING', 'DECLINED'
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    
    // Remove existing RSVP for this user
    session.rsvps = session.rsvps.filter(r => r.userId.toString() !== req.user._id.toString());
    session.rsvps.push({ userId: req.user._id, status });
    await session.save();
    
    res.json({ message: `RSVP updated to ${status}` });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const updateCollabNotes = async (req, res) => {
  try {
    const { content } = req.body;
    if (content === undefined) return res.status(400).json({ message: 'content is required' });
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session not found' });
    // Allow host or any participant to save notes
    const isParticipant = session.participants.map(p => p.toString()).includes(req.user._id.toString());
    const isHost = session.host.toString() === req.user._id.toString();
    if (!isParticipant && !isHost) {
      return res.status(403).json({ message: 'Not authorized to edit notes for this session' });
    }
    session.collabNotes = content;
    await session.save();
    res.json({ message: 'Collab notes saved', collabNotes: session.collabNotes });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCollabNotes = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).select('collabNotes host participants');
    if (!session) return res.status(404).json({ message: 'Session not found' });
    res.json({ collabNotes: session.collabNotes || '' });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { createSession, getSessions, getMySessions, getSessionById, joinSession, leaveSession, deleteSession, addNote, rsvpSession, updateCollabNotes, getCollabNotes };

