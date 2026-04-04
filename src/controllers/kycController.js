const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const User = require('../models/User');

// ── Memory-only storage: image buffer is NEVER written to disk ──
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are accepted for KYC verification.'), false);
    }
  }
}).single('idCard');

// ── Gemini client — tries primary key first, falls back to secondary ──
const getGenAI = () => {
  const key = process.env.GOOGLE_AI_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No Gemini API key configured.');
  return new GoogleGenerativeAI(key);
};

const KYC_MODEL = 'gemini-2.0-flash';

// ── Fuzzy institution name matcher ──
// Returns true if the extracted name loosely matches the claimed university
function institutionMatches(claimed = '', extracted = '') {
  if (!claimed || !extracted) return false;
  const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const c = normalize(claimed);
  const e = normalize(extracted);
  // Direct includes check in both directions
  if (c.includes(e) || e.includes(c)) return true;
  // Word overlap check (>= 50% shared significant words)
  const cWords = c.split(/\s+/).filter(w => w.length > 3);
  const eWords = e.split(/\s+/).filter(w => w.length > 3);
  if (cWords.length === 0 || eWords.length === 0) return false;
  const shared = cWords.filter(w => eWords.includes(w));
  return shared.length / Math.min(cWords.length, eWords.length) >= 0.5;
}

const verifyKYC = (req, res) => {
  upload(req, res, async (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ success: false, message: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Please upload a student ID image.' });
    }

    const imageBase64 = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype;

    // ── Drop the reference immediately. GC will reclaim the buffer. ──
    req.file.buffer = null;

    try {
      const genAI = getGenAI();
      const model = genAI.getGenerativeModel({
        model: KYC_MODEL,
        generationConfig: {
          response_mime_type: 'application/json',
        },
      });

      const systemPrompt = `You are a strict Student ID Verification system. Analyze the provided image carefully.

Your task is to extract key information from a student ID card and return a valid JSON object.

Rules:
1. If the image is NOT a student ID card (e.g., it is a random photo, a document, or an ID of another type), set "isValid" to false and provide a clear "rejectionReason".
2. If the image IS a student ID, extract the student's full name, exact institution name, and expiry/validity year.
3. If the card is blurry, cropped, or unreadable, set "isValid" to false with reason "Image too blurry or incomplete to verify."
4. Return ONLY this JSON structure, no markdown, no extra text:

{
  "isValid": boolean,
  "extractedName": "string or empty string",
  "extractedInstitution": "string or empty string",
  "expiryDate": "string (year or date) or empty string",
  "rejectionReason": "string or null"
}`;

      const result = await model.generateContent([
        systemPrompt,
        {
          inlineData: {
            mimeType: mimeType,
            data: imageBase64,
          }
        }
      ]);

      const rawText = result.response.text().trim();

      // ── Parse the structured JSON from Gemini's response ──
      let parsed;
      try {
        // Strip any markdown code fences if Gemini wrapped it
        const cleaned = rawText.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        parsed = JSON.parse(cleaned);
      } catch (parseErr) {
        console.error('[KYC] Failed to parse Gemini response:', rawText);
        return res.status(500).json({
          success: false,
          message: 'AI analysis returned an unexpected format. Please try again.',
        });
      }

      // ── If AI says invalid, mark as REJECTED ──
      if (!parsed.isValid) {
        await User.findByIdAndUpdate(req.user._id, { kycStatus: 'REJECTED' });
        return res.status(422).json({
          success: false,
          kycStatus: 'REJECTED',
          rejectionReason: parsed.rejectionReason || 'The uploaded image could not be verified as a valid Student ID.',
          extractedName: parsed.extractedName || '',
          extractedInstitution: parsed.extractedInstitution || '',
        });
      }

      // ── Institution cross-validation ──
      const user = await User.findById(req.user._id);
      const claimedInstitution = user.university || '';

      if (claimedInstitution && !institutionMatches(claimedInstitution, parsed.extractedInstitution)) {
        await User.findByIdAndUpdate(req.user._id, { kycStatus: 'REJECTED' });
        return res.status(422).json({
          success: false,
          kycStatus: 'REJECTED',
          rejectionReason: `Institution mismatch. Your profile shows "${claimedInstitution}" but the ID shows "${parsed.extractedInstitution}". Please use the correct student ID.`,
          extractedName: parsed.extractedName,
          extractedInstitution: parsed.extractedInstitution,
        });
      }

      // ── All checks passed: mark as VERIFIED ──
      // Calculate verifiedUntil: prioritize parsed expiry, otherwise give 1 year
      let verifiedUntil = new Date();
      verifiedUntil.setFullYear(verifiedUntil.getFullYear() + 1);
      if (parsed.expiryDate) {
        const year = parseInt(parsed.expiryDate);
        if (!isNaN(year) && year > 2020 && year < 2040) {
          verifiedUntil = new Date(`${year}-12-31`);
        }
      }

      await User.findByIdAndUpdate(req.user._id, {
        kycStatus: 'VERIFIED',
        verificationDetails: {
          verifiedInstitution: parsed.extractedInstitution || claimedInstitution,
          verifiedUntil,
        }
      });

      return res.json({
        success: true,
        kycStatus: 'VERIFIED',
        extractedName: parsed.extractedName,
        extractedInstitution: parsed.extractedInstitution,
        expiryDate: parsed.expiryDate,
        verifiedUntil: verifiedUntil.toISOString(),
      });

    } catch (aiErr) {
      console.error('[KYC] AI error:', aiErr.message);
      // Distinguish quota exhaustion from other errors
      const isQuota = aiErr.message?.includes('429') || aiErr.message?.includes('quota') || aiErr.message?.includes('RESOURCE_EXHAUSTED');
      return res.status(503).json({
        success: false,
        message: isQuota
          ? 'AI verification quota temporarily exhausted. Please try again in a few minutes, or contact support if this persists.'
          : 'AI verification service encountered an error. Please try again.',
      });
    }
  });
};

module.exports = { verifyKYC };
