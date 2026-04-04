const multer = require('multer');
const { v2: cloudinary } = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const path = require('path');

// Configure Cloudinary with Environment Variables
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Determine resource type based on mime type
    let resource_type = 'auto'; // Images and Videos
    if (
      file.mimetype === 'application/pdf' || 
      file.mimetype.includes('msword') || 
      file.mimetype.includes('officedocument') ||
      file.mimetype === 'text/plain'
    ) {
      resource_type = 'raw'; // Document formats
    }

    const safeName = path.basename(file.originalname).replace(/[^a-zA-Z0-9._-]/g, '-');
    
    return {
      folder: 'studybuddy_uploads',
      resource_type: resource_type,
      public_id: `${Date.now()}-${safeName}`,
    };
  },
});

const upload = multer({ 
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max file size to prevent free-tier abuse
}).single('file');

const uploadFile = (req, res) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ message: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ message: err.message });
    }
    if (!req.file) return res.status(400).json({ message: 'No file uploaded' });
    
    // req.file.path contains the securely hosted Cloudinary URL
    res.json({ url: req.file.path, name: req.file.originalname });
  });
};

module.exports = { uploadFile };
