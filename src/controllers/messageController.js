const Message = require('../models/Message');
const User = require('../models/User');
const Admin = require('../models/Admin');
const FlaggedItem = require('../models/FlaggedItem');
const { sendPushToUser } = require('../utils/pushNotification');
const { checkAndCompleteQuest } = require('../utils/questEngine');
const { callGemini } = require('./aiController');


const BAD_WORDS = ['spam', 'abuse', 'offensive', 'scam', 'fake', 'hate', 'slur'];

const filterText = async (text, senderId, receiverId, source) => {
  let flagged = false;
  let cleanText = text;
  BAD_WORDS.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'gi');
    if (regex.test(cleanText)) {
      flagged = true;
      cleanText = cleanText.replace(regex, '***');
    }
  });

  if (flagged) {
    try {
      await FlaggedItem.create({ author: senderId, originalText: text, source: source, recipient: receiverId });
    } catch(err) { console.error('FlaggedItem save error', err); }
  }
  return cleanText;
};

const sendMessage = async (req, res) => {
  try {
    const { receiverId, content } = req.body;
    if (!content || !receiverId) return res.status(400).json({ message: 'Missing payload' });
    
    let receiver = await User.findById(receiverId);
    let isAdminTarget = false;
    if (!receiver) {
       receiver = await Admin.findById(receiverId);
       if (receiver) isAdminTarget = true;
    }
    if (!receiver) return res.status(404).json({ message: 'Target identity not found.' });

    const cleanContent = await filterText(content, req.user._id, receiverId, 'Direct Message');

    const message = await Message.create({ sender: req.user._id, receiver: receiverId, content: cleanContent });
    
    const msgObj = message.toObject();
    let senderObj = await User.findById(req.user._id).select('name avatar').lean();
    if (!senderObj) {
      senderObj = await Admin.findById(req.user._id).select('name avatar').lean();
      if (senderObj) senderObj.isAdmin = true;
    }
    msgObj.sender = senderObj;

    // Emit live to receiver's socket room
    const io = req.app.get('io');
    if (io) {
      io.to(receiverId.toString()).emit('message_received', msgObj);
    }

    // Send browser push to receiver (fire-and-forget, don't block response)
    sendPushToUser(receiverId, {
      title: `💬 New message from ${senderObj?.name || 'Someone'}`,
      body: cleanContent.length > 80 ? cleanContent.substring(0, 80) + '...' : cleanContent,
      icon: '/icons.svg',
      url: '/messages'
    }).catch(() => {});

    // Auto-complete quest
    checkAndCompleteQuest(req.user._id, 'SEND_MESSAGE', io).catch(() => {});

    res.status(201).json(msgObj);

    // AI Support Agent Integration
    if (isAdminTarget) {
      (async () => {
        try {
          const prompt = `You are a helpful, professional, and friendly IT Support Agent for the "StudyFriend" student platform (aka StudyBuddyFinder).
A user has just sent the following message/ticket to support. 
Do your best to assist them, provide exact solutions if you can, or reassure them that the technical team will look into it if it's complex.
Be concise, polite, and use markdown formatting.
User's query: "${cleanContent}"
Support Agent Response:`;
          
          const aiReplyText = await callGemini(prompt);
          
          // Save the AI message mimicking the admin
          const aiMessage = await Message.create({ sender: receiverId, receiver: req.user._id, content: aiReplyText });
          const aiMsgObj = aiMessage.toObject();
          
          aiMsgObj.sender = { _id: receiverId, name: receiver.name, avatar: receiver.avatar, isAdmin: true };
          
          if (io) {
            io.to(req.user._id.toString()).emit('message_received', aiMsgObj);
          }
          
          // Send push back to the user
          sendPushToUser(req.user._id, {
            title: `💬 Support Reply from ${receiver.name || 'System Support'}`,
            body: aiReplyText.length > 80 ? aiReplyText.substring(0, 80) + '...' : aiReplyText,
            icon: '/icons.svg',
            url: '/support'
          }).catch(() => {});
          
        } catch (aiErr) {
          console.error('Support AI failed:', aiErr.message);
        }
      })();
    }

  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


const getConversation = async (req, res) => {
  try {
    const { userId } = req.params;
    const messagesRaw = await Message.find({
      $or: [
        { sender: req.user._id, receiver: userId },
        { sender: userId, receiver: req.user._id }
      ]
    }).lean().sort({ createdAt: 1 });

    const messages = await Promise.all(messagesRaw.map(async msg => {
      let s = await User.findById(msg.sender).select('name avatar').lean();
      if (!s) {
        s = await Admin.findById(msg.sender).select('name avatar').lean();
        if (s) s.isAdmin = true;
      }
      msg.sender = s;
      return msg;
    }));

    await Message.updateMany({ sender: userId, receiver: req.user._id, read: false }, { read: true });
    res.json(messages);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getInbox = async (req, res) => {
  try {
    const messagesRaw = await Message.find({
      $or: [{ sender: req.user._id }, { receiver: req.user._id }]
    }).lean().sort({ createdAt: -1 });

    // Collect unique user IDs from all messages
    const userIds = new Set();
    messagesRaw.forEach(msg => {
      userIds.add(msg.sender.toString());
      userIds.add(msg.receiver.toString());
    });

    // Batch fetch all users and admins in 2 queries
    const [users, admins] = await Promise.all([
      User.find({ _id: { $in: [...userIds] } }).select('name avatar').lean(),
      Admin.find({ _id: { $in: [...userIds] } }).select('name avatar').lean()
    ]);

    const userMap = {};
    users.forEach(u => { userMap[u._id.toString()] = u; });
    admins.forEach(a => { userMap[a._id.toString()] = { ...a, isAdmin: true }; });

    const seen = new Set();
    const conversations = [];

    for (const msg of messagesRaw) {
      const otherId = msg.sender.toString() === req.user._id.toString()
        ? msg.receiver.toString()
        : msg.sender.toString();

      if (!seen.has(otherId)) {
        seen.add(otherId);
        msg.sender = userMap[msg.sender.toString()] || null;
        msg.receiver = userMap[msg.receiver.toString()] || null;
        conversations.push(msg);
      }
    }
    res.json(conversations);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

module.exports = { sendMessage, getConversation, getInbox };
