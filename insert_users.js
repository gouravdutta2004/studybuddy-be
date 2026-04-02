const mongoose = require('mongoose');
require('dotenv').config();
const User = require('./src/models/User');

const subjects = ['Mathematics', 'Computer Science', 'Physics', 'Biology', 'Chemistry', 'History', 'Literature'];
const universities = ['MIT', 'Stanford', 'Harvard', 'Oxford', 'Cambridge', 'Caltech'];
const educationLevels = ['High School', 'Undergraduate', 'Graduate', 'PhD', 'Self-Learner', 'Other'];
const names = ['Alice Cooper', 'Bob Smith', 'Charlie Johnson', 'Diana Prince', 'Eve Adams', 'Frank Castle', 'Grace Hopper', 'Hank Pym', 'Ivy League', 'Jack Ryan', 'Karen Page', 'Leo Tolstoy', 'Mia Wallace', 'Noah Bennett', 'Olivia Pope', 'Peter Parker', 'Quinn Fabray', 'Rachel Green', 'Steve Rogers', 'Tony Stark'];

const users = names.map((name, i) => ({
  name,
  email: `user${i}@example.com`,
  password: 'password123',
  bio: `Hi, I am ${name} and I love studying and collaborating!`,
  subjects: [subjects[i % subjects.length], subjects[(i + 1) % subjects.length]],
  educationLevel: educationLevels[i % educationLevels.length],
  university: universities[i % universities.length],
  location: i % 2 === 0 ? 'New York, USA' : 'London, UK',
  studyHours: Math.floor(Math.random() * 100),
  streak: Math.floor(Math.random() * 30),
  xp: Math.floor(Math.random() * 1000),
  level: Math.floor(Math.random() * 10) + 1,
  badges: [],
}));

async function insertData() {
  try {
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/studyfriend');
    console.log('Connected to DB');
    
    // Insert array
    for (const u of users) {
       const newUser = new User(u);
       await newUser.save(); // using .save() so that pre('save') hook runs and hashes the password
    }
    console.log('Successfully inserted 20 users.');
    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

insertData();
