require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');
const Admin = require('./src/models/Admin');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/study-buddy');
    
    const adminUser = await User.findOne({ email: 'admin@test.com' });
    if (adminUser) {
      console.log('Found admin@test.com in User collection. Migrating...');
      
      const adminData = adminUser.toObject();
      delete adminData._id;
      delete adminData.isAdmin;
      
      const existingInAdmin = await Admin.findOne({ email: 'admin@test.com' });
      if (!existingInAdmin) {
        const newAdmin = await Admin.create(adminData);
        console.log(`Migrated Root Admin with ID: ${newAdmin._id}`);
      } else {
        console.log('Root Admin already exists in Admin collection.');
      }
      
      await User.deleteOne({ email: 'admin@test.com' });
      console.log('Removed from User collection.');
    } else {
      console.log('No root admin found in User collection.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
