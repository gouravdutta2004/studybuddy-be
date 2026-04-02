const User = require('../models/User');

const getCampusPeers = async (req, res) => {
  try {
    const { organization, _id } = req.user;
    if (!organization) return res.status(400).json({ message: 'Global users do not belong to an institution campus.' });

    // Retrieve global isolated real-time socket map
    const onlineUsers = req.app.get('onlineUsers');

    // Query all students in this exact organization, excluding self
    const peers = await User.find({ 
      organization, 
      _id: { $ne: _id } 
    }).select('name avatar email').lean();
    
    // Synchronously iterate and map current connectivity flags
    const peersWithStatus = peers.map(peer => {
      // Keys in Map are stored as strings through join_campus payloads. Make sure types strictly match.
      return { 
        ...peer, 
        isOnline: onlineUsers.has(peer._id.toString()) 
      };
    });

    // Sort to promote online students to top of lists
    peersWithStatus.sort((a, b) => b.isOnline - a.isOnline);

    res.json(peersWithStatus);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getCampusPeers };
