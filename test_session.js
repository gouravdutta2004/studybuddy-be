const mongoose = require('mongoose');
const User = require('./src/models/User');
const Session = require('./src/models/Session');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const user = await User.findOne();
  console.log("Found user:", user.email);

  // find a session where the user is NOT a participant
  const session = await Session.findOne({ participants: { $ne: user._id } });
  if (!session) {
    console.log("No session available to test.");
    process.exit(0);
  }
  
  console.log("Session before join:", session._id, session.participants);

  session.participants.push(user._id);
  await session.save();

  console.log("Session after join:", session.participants);

  const mySessions = await Session.find({
      $or: [{ host: user._id }, { participants: user._id }]
  });
  console.log("Does mySessions return it?", mySessions.some(s => s._id.toString() === session._id.toString()));
  process.exit(0);
}
run();
