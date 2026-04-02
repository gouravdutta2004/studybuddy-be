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
app.use('/api/billing', require('./src/routes/billing.routes'));
app.use('/api/push', require('./src/routes/push'));
app.use('/api/campus', require('./src/routes/campus'));

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

  socket.on('whiteboard_update', ({ roomId, elements }) => {
    socket.to(roomId).emit('whiteboard_update', elements);
  });

  // ── Collaborative Notes ──
  socket.on('collab_notes_update', ({ roomId, content }) => {
    roomNotes.set(roomId, content);
    socket.to(roomId).emit('collab_notes_update', { content });
  });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on port ${PORT} with WebSockets enabled`));

