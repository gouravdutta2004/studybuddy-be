const mongoose = require('mongoose');
require('dotenv').config({ path: '/Users/gourav/Documents/StudyBuddyFinder/be/.env' });
const User = require('./src/models/User');

mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/studyfriend')
  .then(async () => {
    let user = await User.findOne({ email: 'admin@test.com' });
    console.log('User found:', user ? user.email : 'No user');
    if (user) {
      console.log('isAdmin status:', user.isAdmin);
      if (!user.isAdmin) {
        user.isAdmin = true;
        await user.save();
        console.log('Forced isAdmin to true!');
      }
    } else {
        console.log('Creating @test.com from scratch...');
        user = await User.create({
            name: "Super Admin",
            email: "admin@test.com",
            password: "123456",
            isAdmin: true,
            isActive: true
        });
        console.log('Created!', user);
    }
    process.exit(0);
  })
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
