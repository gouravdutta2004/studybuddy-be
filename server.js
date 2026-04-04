require('dotenv').config();
const express = require('express');
const cors = require('cors');
const connectDB = require('./src/config/db');

connectDB();

const app = express();
const allowedOrigins = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:5174',
  'http://127.0.0.1:5174',
  'http://localhost:3000',
  'https://studyfriend.pages.dev',
  /\.studyfriend\.pages\.dev$/,
  'https://studybuddy-fe.pages.dev',
  /\.studybuddy-fe\.pages\.dev$/,
  'https://studyfriend.co.in',
  'http://studyfriend.co.in'
];

app.use(cors({ 
  origin: allowedOrigins, 
  credentials: true 
}));
app.use(express.json());

app.use('/uploads', require('./src/middleware/auth').protect, express.static('uploads'));
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/users', require('./src/routes/users'));
app.use('/api/upload', require('./src/routes/upload'));
app.use('/api/sessions', require('./src/routes/sessions'));
app.use('/api/rooms', require('./src/routes/room'));
app.use('/api/groups', require('./src/routes/groups'));
app.use('/api/ratings', require('./src/routes/ratings'));
app.use('/api/messages', require('./src/routes/messages'));
app.use('/api/admin', require('./src/routes/adminRoutes'));
app.use('/api/settings', require('./src/routes/settingsRoutes'));
app.use('/api/gamification', require('./src/routes/gamification'));
app.use('/api/notifications', require('./src/routes/notifications'));
app.use('/api/calendar', require('./src/routes/calendar'));
app.use('/api/ai', require('./src/routes/ai'));
app.use('/api/activity', require('./src/routes/activity'));
app.use('/api/contracts', require('./src/routes/contracts'));
app.use('/api/billing', require('./src/routes/billing.routes'));
app.use('/api/billing', require('./src/routes/pricingRoutes'));
app.use('/api/push', require('./src/routes/push'));
app.use('/api/campus', require('./src/routes/campus'));
app.use('/api/universities', require('./src/routes/universities'));
app.use('/api/public/stats', require('./src/routes/platformStats'));
app.use('/api/whobee', require('./src/routes/whobee')); // Whobee RAG AI — public, no auth required
app.use('/api/kyc', require('./src/routes/kyc')); // Student KYC Verification

app.get('/api/health', (req, res) => res.json({ status: 'OK', message: 'StudyFriend API running' }));

// ----- GLOBAL PRESENCE MAP -----
const onlineUsers = new Map();
app.set('onlineUsers', onlineUsers);

// ----- LIVE ROOMS TRACKING -----
const liveRooms = new Map(); // roomId -> { roomId, title, subject, participants[], hostName }
app.set('liveRooms', liveRooms);

// ----- COLLAB NOTES PER ROOM -----
const roomNotes = new Map(); // roomId -> string (current note content)

const http = require('http');
const { Server } = require('socket.io');

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: allowedOrigins, credentials: true }
});

app.set('io', io);

io.on('connection', (socket) => {
  console.log('🟢 Socket initialized: ', socket.id);

  socket.on('setup', (userId) => {
    socket.join(userId);
  });

  socket.on('join_chat', (room) => {
    socket.join(room);
  });

  socket.on('typing', (data) => socket.to(data.receiver).emit('typing', data));
  socket.on('stop_typing', (data) => socket.to(data.receiver).emit('stop_typing', data));

  socket.on('new_message', (message) => {
    socket.to(message.receiver).emit('message_received', message);
  });

  // ── 1-on-1 WebRTC Calling (Messages) ──
  // Track pending outbound calls: callerSocketId -> { userToCall, timer }
  const pendingCalls = new Map();

  socket.on('call_user', (data) => {
    // data: { userToCall, signalData, from, callerInfo, isVideo }
    // Emit incoming_call to receiver's personal room (joined on 'setup')
    socket.to(data.userToCall).emit('incoming_call', {
      signal: data.signalData,
      from: data.from,         // caller's socket.id
      callerInfo: data.callerInfo,
      isVideo: data.isVideo,
    });

    // Phase 2: ACK timeout — if receiver doesn't ACK within 5s, caller sees 'unavailable'
    const timeout = setTimeout(() => {
      // Check if call is still pending (not yet ACKed)
      if (pendingCalls.has(socket.id)) {
        pendingCalls.delete(socket.id);
        socket.emit('call_unavailable');
      }
    }, 5000);

    pendingCalls.set(socket.id, { userToCall: data.userToCall, timeout });
  });

  // Receiver ACKs that they received the ring
  socket.on('call_ack', (data) => {
    // data: { to } — the caller's socket.id
    // Find caller's pending call and clear their timeout
    if (data.to) {
      // Relay ack to the caller socket
      io.to(data.to).emit('call_ack');
      // Clear timeout on server if stored under caller socket id
      if (pendingCalls.has(data.to)) {
        clearTimeout(pendingCalls.get(data.to).timeout);
        pendingCalls.delete(data.to);
      }
    }
  });

  // Caller cancels the call before it's answered
  socket.on('cancel_call', (data) => {
    if (data.userToCall) {
      socket.to(data.userToCall).emit('call_ended');
    }
    if (pendingCalls.has(socket.id)) {
      clearTimeout(pendingCalls.get(socket.id).timeout);
      pendingCalls.delete(socket.id);
    }
  });

  socket.on('answer_call', (data) => {
    // data: { to (caller's socket.id), signal }
    socket.to(data.to).emit('call_accepted', data.signal);
  });

  socket.on('reject_call', (data) => {
    socket.to(data.to).emit('call_rejected');
  });

  socket.on('end_call', (data) => {
    if (data.to) socket.to(data.to).emit('call_ended');
  });

  // Phase 1: Trickle ICE candidate relay
  socket.on('ice_candidate', (data) => {
    // data: { to, candidate }
    socket.to(data.to).emit('ice_candidate', { candidate: data.candidate, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log('🔴 Socket terminated: ', socket.id);
    if (socket.userId && socket.organizationId) {
      onlineUsers.delete(socket.userId);
      socket.to(socket.organizationId).emit('user_status_change', { userId: socket.userId, status: 'offline' });
    }
    // Remove from any live room they were in
    if (socket.liveRoomId) {
      const room = liveRooms.get(socket.liveRoomId);
      if (room) {
        room.participants = room.participants.filter(p => p.socketId !== socket.id);
        if (room.participants.length === 0) {
          liveRooms.delete(socket.liveRoomId);
        } else {
          liveRooms.set(socket.liveRoomId, room);
        }
        io.emit('live_rooms_update', Array.from(liveRooms.values()));
      }
    }
  });

  // Walled Garden Presence
  socket.on('join_campus', ({ userId, organizationId }) => {
    if (!organizationId) return;
    socket.join(organizationId);
    socket.userId = userId;
    socket.organizationId = organizationId;
    onlineUsers.set(userId, socket.id);
    socket.to(organizationId).emit('user_status_change', { userId, status: 'online' });
  });

  // ── Study Room: WebRTC, Whiteboard, Live Rooms, Collab Notes ──
  socket.on('join_study_room', ({ roomId, userId, userName, title, subject } = {}) => {
    // Support both old string format and new object format
    const rId = typeof roomId === 'string' ? roomId : (roomId?.roomId || roomId);
    socket.join(rId);
    socket.liveRoomId = rId;
    socket.userId = userId || socket.userId;

    // Register in live rooms
    if (!liveRooms.has(rId)) {
      liveRooms.set(rId, { roomId: rId, title: title || 'Study Room', subject: subject || 'General', participants: [] });
    }
    const room = liveRooms.get(rId);
    if (!room.participants.find(p => p.socketId === socket.id)) {
      room.participants.push({ socketId: socket.id, userId, userName: userName || 'Scholar' });
    }
    liveRooms.set(rId, room);

    // Broadcast updated live rooms list to everyone
    io.emit('live_rooms_update', Array.from(liveRooms.values()));

    // Notify others in room
    socket.to(rId).emit('user_joined_room', socket.id);

    // Send current collab notes to new joiner
    const currentNotes = roomNotes.get(rId) || '';
    socket.emit('collab_notes_init', { roomId: rId, content: currentNotes });
  });

  // ── SOS Breakdown Buddy System ──
  socket.on('trigger_sos', async (payload) => {
    // payload: { subject, topic, userId, userName }
    try {
      const User = require('./src/models/User');
      const onlineIds = Array.from(onlineUsers.keys()).filter(id => id !== String(payload.userId));

      if (onlineIds.length === 0) {
        // Nobody online — emit back to caller so they know
        socket.emit('sos_no_experts');
        return;
      }

      // Try to find subject-matched experts first
      let experts = await User.find({
        _id: { $in: onlineIds },
        subjects: { $elemMatch: { $regex: new RegExp(payload.subject, 'i') } },
      }).select('_id name').lean();

      // Fallback: broadcast to ALL online users if no subject match
      if (experts.length === 0) {
        experts = await User.find({ _id: { $in: onlineIds } }).select('_id').lean();
      }

      let sent = 0;
      experts.forEach(expert => {
        const expertSocketId = onlineUsers.get(expert._id.toString());
        if (expertSocketId) {
          io.to(expertSocketId).emit('incoming_sos', payload);
          sent++;
        }
      });

      // Tell the caller how many experts were pinged
      socket.emit('sos_broadcast_count', { count: sent });

    } catch (err) {
      console.error('SOS Error:', err);
      socket.emit('sos_error', { message: err.message });
    }
  });

  socket.on('accept_sos', (payload) => {
    // payload: { callerId (userId string), helperName }
    const roomId = `sos_${Date.now()}`;

    // Look up caller's current socket ID from the userId->socketId map
    const callerSocketId = onlineUsers.get(String(payload.callerId));

    if (callerSocketId) {
      io.to(callerSocketId).emit('sos_accepted', {
        roomId,
        helperName: payload.helperName,
        helperSocketId: socket.id,
      });
    }

    // Also notify the helper (acceptor)
    socket.emit('sos_accepted', {
      roomId,
      helperName: payload.helperName,
      isHelper: true,
    });
  });

  socket.on('leave_study_room', async ({ roomId } = {}) => {
    const rId = typeof roomId === 'string' ? roomId : roomId?.roomId;
    if (!rId) return;
    socket.leave(rId);
    socket.liveRoomId = null;

    const room = liveRooms.get(rId);
    if (room) {
      room.participants = room.participants.filter(p => p.socketId !== socket.id);
      if (room.participants.length === 0) {
        liveRooms.delete(rId);
        // Persist collab notes to DB when last user leaves
        const finalNotes = roomNotes.get(rId);
        if (finalNotes) {
          try {
            const Session = require('./src/models/Session');
            await Session.findByIdAndUpdate(rId, { collabNotes: finalNotes });
          } catch (e) { /* silent */ }
          roomNotes.delete(rId);
        }
      } else {
        liveRooms.set(rId, room);
      }
      io.emit('live_rooms_update', Array.from(liveRooms.values()));
    }
  });

  socket.on('room_message', ({ roomId, message }) => {
    socket.to(roomId).emit('room_message', message);
  });

  socket.on('webrtc_signal', (data) => {
    io.to(data.to).emit('webrtc_signal', {
      signal: data.signal,
      from: socket.id
    });
  });

  socket.on('whiteboard_update', (payload) => {
    socket.to(payload.roomId).emit('whiteboard_update', payload);
  });

  socket.on('ready_for_webrtc', ({ roomId }) => {
    // Emit purely to signal that this client has initialized their camera/mic
    // and is completely ready to receive connection offers.
    socket.to(roomId).emit('user_ready_for_webrtc', socket.id);
  });

  // ── Collaborative Notes ──
  socket.on('collab_notes_update', ({ roomId, content }) => {
    roomNotes.set(roomId, content);
    socket.to(roomId).emit('collab_notes_update', { content });
  });

  // ── Group Pomodoro ──
  socket.on('pomodoro:sync', ({ roomId, timeLeft, running, mode }) => {
    if (!roomId) return;
    socket.to(roomId).emit('pomodoro:sync', { timeLeft, running, mode });
  });
  socket.on('pomodoro:tick', ({ roomId, timeLeft }) => {
    if (!roomId) return;
    socket.to(roomId).emit('pomodoro:tick', { timeLeft });
  });

  // ── Raise Hand ──
  socket.on('hand:raise', ({ roomId, userId, name, avatar }) => {
    if (!roomId) return;
    socket.to(roomId).emit('hand:raise', { userId, name, avatar });
  });
  socket.on('hand:lower', ({ roomId, userId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('hand:lower', { userId });
  });

  // ── Live Poll ──
  socket.on('poll:create', ({ roomId, poll }) => {
    if (!roomId) return;
    // Normalize options and store server-side
    const tracked = { ...poll, options: poll.options.map(o => ({ ...o, votes: 0, voters: [] })) };
    if (!global.roomPolls) global.roomPolls = {};
    global.roomPolls[roomId] = tracked;
    // Send to everyone in the room (including creator)
    io.to(roomId).emit('poll:new', tracked);
  });
  socket.on('poll:vote', ({ roomId, optionIndex, userId }) => {
    if (!roomId) return;
    // Track votes server-side per room (in-memory)
    if (!global.roomPolls) global.roomPolls = {};
    if (!global.roomPolls[roomId]) return;
    const poll = global.roomPolls[roomId];
    if (!poll.options[optionIndex].voters.includes(userId)) {
      poll.options[optionIndex].votes++;
      poll.options[optionIndex].voters.push(userId);
      global.roomPolls[roomId] = poll;
    }
    io.to(roomId).emit('poll:update', poll);
  });
  socket.on('poll:end', ({ roomId }) => {
    if (!roomId) return;
    if (global.roomPolls) delete global.roomPolls[roomId];
    io.to(roomId).emit('poll:end');
  });

  // ── Task Board ──
  socket.on('task:add', ({ roomId, task }) => {
    if (!roomId) return;
    socket.to(roomId).emit('task:add', task);
  });
  socket.on('task:move', ({ roomId, id, col }) => {
    if (!roomId) return;
    socket.to(roomId).emit('task:move', { id, col });
  });
  socket.on('task:remove', ({ roomId, id }) => {
    if (!roomId) return;
    socket.to(roomId).emit('task:remove', { id });
  });

  // ── Voice Reactions ──
  socket.on('reaction:emit', ({ roomId, emoji, color, userId }) => {
    if (!roomId) return;
    socket.to(roomId).emit('reaction:emit', { emoji, color, userId });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with WebSockets enabled`));

