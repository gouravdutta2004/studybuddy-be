const express = require('express');
const router = express.Router();
const { 
  getUsers, updateUser, deleteUser, createUser, 
  getSystemConnections, severSystemConnection, 
  getSubjects, createSubject, deleteSubject, 
  getFeedback, updateFeedbackStatus, broadcastEmail,
  getDashboardStats, getUserGrowth, getSessionStats, getSystemHealth,
  getSystemConfigs, saveSystemConfig, getAuditLogs, bulkActionUsers,
  getReports, updateReport, scanContent, updateFlaggedItem,
  getGamificationLeaderboard, awardBadge,
  getPendingUsers, approveUser, rejectUser,
  getOrgUsers, toggleOrgUserStatus, deleteOrgUser, getOrgDashboardStats,
  getGlobalOrganizations, createOrganization, updateOrganization, deleteOrganization, getGlobalPendingUsers,
  getGlobalSquads, disbandSquad, getGlobalQuests, injectQuest
} = require('../controllers/adminController');
const { protect, admin, isOrgAdmin } = require('../middleware/auth');
const authorizeRole = require('../middleware/rbac');

// ── ORG ADMIN HYBRID AUTH ROUTES ── //
router.post('/auth/login', require('../controllers/adminAuthController').login);
router.get('/pending-users', protect, isOrgAdmin, getPendingUsers);
router.put('/users/:id/approve', protect, isOrgAdmin, approveUser);
router.put('/users/:id/reject', protect, isOrgAdmin, rejectUser);

router.get('/org-stats', protect, isOrgAdmin, getOrgDashboardStats);
router.get('/org-users', protect, isOrgAdmin, getOrgUsers);
router.put('/org-users/:id/toggle', protect, isOrgAdmin, toggleOrgUserStatus);
router.delete('/org-users/:id', protect, isOrgAdmin, deleteOrgUser);

// ── GLOBAL GOD-MODE (SUPER ADMIN) ROUTES ── //
router.get('/organizations', protect, admin, authorizeRole('Super Admin', 'Moderator'), getGlobalOrganizations);
router.post('/organizations', protect, admin, authorizeRole('Super Admin'), createOrganization);
router.put('/organizations/:id', protect, admin, authorizeRole('Super Admin'), updateOrganization);
router.delete('/organizations/:id', protect, admin, authorizeRole('Super Admin'), deleteOrganization);
router.get('/pending-users/global', protect, admin, authorizeRole('Super Admin', 'Moderator'), getGlobalPendingUsers);


router.get('/users', protect, admin, authorizeRole('Moderator'), getUsers);
router.post('/users', protect, admin, authorizeRole('Super Admin'), createUser);
router.put('/users/:id', protect, admin, authorizeRole('Moderator'), updateUser);
router.delete('/users/:id', protect, admin, authorizeRole('Super Admin'), deleteUser);

router.get('/connections', protect, admin, authorizeRole('Moderator'), getSystemConnections);
router.delete('/connections/:userA/:userB', protect, admin, authorizeRole('Super Admin'), severSystemConnection);

router.get('/subjects', protect, admin, authorizeRole('Moderator'), getSubjects);
router.post('/subjects', protect, admin, authorizeRole('Super Admin'), createSubject);
router.delete('/subjects/:id', protect, admin, authorizeRole('Super Admin'), deleteSubject);

router.post('/broadcast', protect, admin, authorizeRole('Super Admin'), broadcastEmail);
router.post('/users/bulk', protect, admin, authorizeRole('Super Admin'), bulkActionUsers);

router.get('/analytics/dashboard', protect, admin, authorizeRole('Moderator'), getDashboardStats);
router.get('/analytics/growth', protect, admin, authorizeRole('Moderator'), getUserGrowth);
router.get('/analytics/sessions', protect, admin, authorizeRole('Moderator'), getSessionStats);
router.get('/health', protect, admin, authorizeRole('Super Admin'), getSystemHealth);

router.get('/reports', protect, admin, authorizeRole('Support Agent', 'Moderator'), getReports);
router.put('/reports/:id', protect, admin, authorizeRole('Support Agent', 'Moderator'), updateReport);

router.get('/feedback', protect, admin, authorizeRole('Support Agent', 'Moderator'), getFeedback);
router.put('/feedback/:id', protect, admin, authorizeRole('Support Agent', 'Moderator'), updateFeedbackStatus);

router.get('/content-scan', protect, admin, authorizeRole('Moderator'), scanContent);
router.put('/flagged-items/:id', protect, admin, authorizeRole('Moderator'), updateFlaggedItem);

router.get('/configs', protect, admin, authorizeRole('Super Admin'), getSystemConfigs);
router.post('/configs', protect, admin, authorizeRole('Super Admin'), saveSystemConfig);

router.get('/audit-logs', protect, admin, authorizeRole('Support Agent', 'Moderator'), getAuditLogs);

router.get('/gamification/leaderboard', protect, admin, authorizeRole('Super Admin', 'Moderator'), getGamificationLeaderboard);
router.post('/gamification/badge', protect, admin, authorizeRole('Super Admin'), awardBadge);
router.get('/gamification/quests', protect, admin, authorizeRole('Super Admin', 'Moderator'), getGlobalQuests);
router.post('/gamification/quests', protect, admin, authorizeRole('Super Admin'), injectQuest);

router.get('/squads', protect, admin, authorizeRole('Super Admin', 'Moderator'), getGlobalSquads);
router.delete('/squads/:id', protect, admin, authorizeRole('Super Admin'), disbandSquad);

module.exports = router;
