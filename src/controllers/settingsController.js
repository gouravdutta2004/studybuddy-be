const Settings = require('../models/Settings');

exports.getSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

exports.updateSettings = async (req, res) => {
  try {
    let settings = await Settings.findOne();
    if (!settings) {
      settings = await Settings.create({});
    }
    
    settings.welcomeTitle = req.body.welcomeTitle ?? settings.welcomeTitle;
    settings.welcomeSubtitle = req.body.welcomeSubtitle ?? settings.welcomeSubtitle;
    settings.showQuickActions = req.body.showQuickActions ?? settings.showQuickActions;
    settings.showSuggestedMatches = req.body.showSuggestedMatches ?? settings.showSuggestedMatches;
    settings.showStatCards = req.body.showStatCards ?? settings.showStatCards;
    settings.showProfileIncompleteBanner = req.body.showProfileIncompleteBanner ?? settings.showProfileIncompleteBanner;
    
    // NEW COMM FIELDS
    settings.announcementBannerActive = req.body.announcementBannerActive !== undefined ? req.body.announcementBannerActive : settings.announcementBannerActive;
    settings.announcementBannerText = req.body.announcementBannerText !== undefined ? req.body.announcementBannerText : settings.announcementBannerText;
    settings.emailTemplateWelcome = req.body.emailTemplateWelcome !== undefined ? req.body.emailTemplateWelcome : settings.emailTemplateWelcome;
    settings.emailTemplateReset = req.body.emailTemplateReset !== undefined ? req.body.emailTemplateReset : settings.emailTemplateReset;
    settings.emailTemplateBroadcast = req.body.emailTemplateBroadcast !== undefined ? req.body.emailTemplateBroadcast : settings.emailTemplateBroadcast;
    
    const updated = await settings.save();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};
