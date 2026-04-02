const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  welcomeTitle: { type: String, default: "Welcome back" },
  welcomeSubtitle: { type: String, default: "Find your perfect studyfriend and achieve your goals together." },
  showQuickActions: { type: Boolean, default: true },
  showSuggestedMatches: { type: Boolean, default: true },
  showStatCards: { type: Boolean, default: true },
  showProfileIncompleteBanner: { type: Boolean, default: true },
  announcementBannerActive: { type: Boolean, default: false },
  announcementBannerText: { type: String, default: "" },
  emailTemplateWelcome: { type: String, default: "<h1>Welcome {name}!</h1><p>We are glad to have you.</p>" },
  emailTemplateReset: { type: String, default: '<h1>Reset Password</h1><p>Click <a href="{link}">here</a> to reset.</p>' },
  emailTemplateBroadcast: { type: String, default: '<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;"><h2>Hello {name},</h2><div style="padding: 20px; background: #f9fafb; border-radius: 8px; margin: 20px 0; white-space: pre-wrap;">{message}</div><p style="color: #6b7280; font-size: 14px;">- The StudyFriend Administrative Team</p></div>' }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
