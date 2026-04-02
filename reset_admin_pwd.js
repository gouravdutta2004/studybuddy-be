require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');

(async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/study-buddy');
    
    const adminUser = await Admin.findOne({ email: 'admin@test.com' });
    if (adminUser) {
      adminUser.password = 'admin123';
      await adminUser.save();
      console.log('Password reset successfully to admin123');
    } else {
      console.log('Admin not found in DB');
    }
    
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
})();
