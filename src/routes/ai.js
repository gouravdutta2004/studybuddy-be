const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const aiController = require('../controllers/aiController');

router.post('/chat', protect, aiController.chat);
router.post('/squad-tutor', protect, aiController.squadTutor);
router.post('/flashcards', protect, aiController.generateFlashcards);
router.post('/quiz', protect, aiController.generateQuiz);

module.exports = router;

