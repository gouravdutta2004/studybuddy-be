const router = require('express').Router();
const { protect } = require('../middleware/auth');
const {
  getProfile, updateProfile, searchUsers, getMatches, skipMatch,
  sendRequest, acceptRequest, rejectRequest, getConnections, disconnectUser,
  submitFeedback, getPublicSubjects, logStudy, getLeaderboard,
  getSharedStudyHours, getMyProfile
} = require('../controllers/userController');


router.post('/feedback', protect, submitFeedback);
router.get('/subjects', protect, getPublicSubjects);

router.get('/support-admin', protect, require('../controllers/userController').getSupportAdmin);
router.get('/search', protect, searchUsers);
router.get('/matches', protect, getMatches);
router.get('/connections', protect, getConnections);
router.get('/leaderboard', protect, getLeaderboard);

// GPS routes removed — platform now uses Semantic Nebula (subject-based clustering)
// router.get('/nearby', protect, getNearbyUsers);
// router.put('/profile/location', protect, updateLocation);
router.get('/profile', protect, getMyProfile);

router.put('/profile', protect, updateProfile);
router.post('/log-study', protect, logStudy);
router.post('/sync-github', protect, require('../controllers/userController').syncGithub);
router.get('/analytics/me', protect, require('../controllers/userController').getMyAnalytics);


router.get('/:id/quick-peek',    protect, require('../controllers/userController').getQuickPeek);
router.get('/:id/shared-study-hours', protect, getSharedStudyHours);
router.get('/:id',               protect, getProfile);

router.post('/matches/:userId/skip', protect, skipMatch);
router.post('/connect/:userId', protect, sendRequest);
router.post('/accept/:userId', protect, acceptRequest);
router.post('/reject/:userId', protect, rejectRequest);
router.post('/disconnect/:userId', protect, disconnectUser);

module.exports = router;
