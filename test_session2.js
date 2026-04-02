const mongoose = require('mongoose');
const Session = require('./src/models/Session');
require('dotenv').config();

async function run() {
  await mongoose.connect(process.env.MONGO_URI);
  const session = await Session.findOne();
  if (!session) {
    console.log("No session available.");
    process.exit(0);
  }
  console.log("Found:", session._id.toString());
  process.exit(0);
}
run();
