const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Pinecone } = require('@pinecone-database/pinecone');

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getGenAI() {
  return new GoogleGenerativeAI(process.env.GEMINI_API_KEY || process.env.GOOGLE_AI_KEY);
}

function getPineconeIndex() {
  const pc = new Pinecone({ apiKey: process.env.PINECONE_API_KEY });
  return pc.index(process.env.PINECONE_INDEX_NAME || 'studyfriend-knowledge');
}

// Pinecone index was created with 768 dimensions — we slice Gemini's 3072-dim output
const PINECONE_DIMS = 768;

// Embed a single string via Gemini
async function embedText(text) {
  const genAI = getGenAI();
  const model = genAI.getGenerativeModel({ model: 'models/gemini-embedding-001' });
  const result = await model.embedContent({
    content: { parts: [{ text }], role: 'user' },
    // If the SDK version supports it, request 768 output dims directly:
    // outputDimensionality: PINECONE_DIMS,
  });
  // Truncate to match the existing Pinecone index dimension (768)
  return result.embedding.values.slice(0, PINECONE_DIMS);
}

// Embed many strings (sequential to respect rate limits)
async function embedMany(texts) {
  const results = [];
  for (const text of texts) {
    results.push(await embedText(text));
  }
  return results;
}

// ─── Platform Knowledge Base ──────────────────────────────────────────────────
const platformKnowledge = [
  "StudyFriend is a premium study-matching platform that uses a cognitive compatibility algorithm to pair students based on focus span, learning type, energy peaks, and academic subjects.",
  "The Free Tier gives users 3 AI matches per month. The Pro Tier costs ₹299/month and offers unlimited matching, Live Study Hubs, priority SOS support, and AI flashcard generation. The Elite Tier costs ₹599/month and includes everything in Pro plus Study Squad creation, advanced analytics, and the AI Study Tutor.",
  "Accountability Contracts are binding study agreements. If a user ghosts a scheduled study session, their contract is breached — they lose 500 XP, their consistency score drops by 10 points, and a warning is added to their profile.",
  "XP (Experience Points) is the core currency. Users earn XP by completing sessions, logging Pomodoro focus time, winning quizzes, and maintaining daily streaks. Breaching a contract deducts 500 XP.",
  "The SOS Breakdown Buddy feature lets a student press a panic button when stuck. It broadcasts a real-time Socket.io alert to all online users who have expertise in the subject, who can volunteer to help immediately.",
  "To start your first study session: complete your Psyche Profile during onboarding, then click 'Launch First Hub' from your dashboard. You can also browse existing sessions under the Sessions tab.",
  "The Leaderboard ranks students by XP, streaks, and session count. Top 3 global or institution users earn special badges displayed on their profile.",
  "Study Squads (Groups) allow up to 20 students to form private or public study groups with shared goals, a collaborative Pomodoro timer, a group Kanban task board, and a shared notes editor.",
  "The Pomodoro Focus feature defaults to 25-minute work intervals with 5-minute breaks. In a Study Room, it syncs across all participants in real-time so everyone focuses together.",
  "To reset your password, click 'Forgot Password' on the login page and enter your institution email. A secure reset link will be sent within 2 minutes.",
  "Gamification badges include: 'First Session', 'Streak Warrior' (7-day streak), 'SOS Hero' (helped 5 students), 'Top Matcher' (90%+ match score), and 'Scholar' (Level 10).",
  "StudyFriend supports Walled Garden mode for institutions. Students are matched only within their campus using a private leaderboard and organization-level analytics.",
  "The AI Flashcard generator is powered by Gemini. Enter any topic and the platform generates up to 20 high-quality flashcards with difficulty ratings. This is a Pro feature.",
  "Live Study Rooms support WebRTC video/audio, a collaborative whiteboard (tldraw), shared Pomodoro timer, group chat, raise-hand, and live polls.",
  "For technical support, click the Support icon in the navigation. Submit a ticket or browse help center articles.",
  "Cognitive matching considers: Focus Span (short/medium/long), Energy Peak (morning/afternoon/evening), Learning Style (visual/auditory/reading/kinesthetic), and Subject Overlap to produce a compatibility score.",
];

// ─── SEED Route — run once to populate Pinecone ────────────────────────────
// GET /api/whobee/seed
router.get('/seed', async (req, res) => {
  try {
    console.log('[Whobee] Seeding Pinecone with', platformKnowledge.length, 'knowledge chunks...');
    const embeddings = await embedMany(platformKnowledge);

    const records = embeddings.map((values, i) => ({
      id: `sf-knowledge-${i}`,
      values,
      metadata: { text: platformKnowledge[i] },
    }));

    const index = getPineconeIndex();
    // New Pinecone SDK: pass { records: [...] }
    await index.upsert({ records });

    res.json({ success: true, message: `Whobee seeded ${records.length} knowledge chunks into Pinecone!` });
  } catch (err) {
    console.error('[Whobee Seed Error]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── CHAT Route — streaming RAG with SSE ─────────────────────────────────────
// POST /api/whobee/chat
router.post('/chat', async (req, res) => {
  try {
    const { messages } = req.body;
    if (!messages || !messages.length) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const latestMessage = messages[messages.length - 1].content;

    // 1. Embed the user query
    let retrievedContext = 'No specific platform documentation found.';
    try {
      const queryVector = await embedText(latestMessage);

      // 2. Query Pinecone
      const index = getPineconeIndex();
      const queryResponse = await index.query({
        vector: queryVector,
        topK: 3,
        includeMetadata: true,
      });

      if (queryResponse.matches?.length > 0) {
        retrievedContext = queryResponse.matches
          .map((m) => m.metadata?.text)
          .filter(Boolean)
          .join('\n\n');
      }
    } catch (ragErr) {
      console.warn('[Whobee] RAG retrieval failed, falling back to base model:', ragErr.message);
    }

    // 3. Build system prompt with RAG context
    const systemPrompt = `You are Whobee 🤖, the friendly and intelligent AI assistant built into the StudyFriend platform — a global premium study-matching ecosystem.

Your personality is warm, encouraging, and precise. Use occasional emojis to feel approachable but remain professional.

Answer the user's question using ONLY the context provided below. If the answer is not in the context, say: "I don't have that info yet, but I'm still learning! Reach our support team for help."

Do NOT make up features or pricing. Keep answers concise and formatted in markdown.

--- STUDYFRIEND PLATFORM CONTEXT ---
${retrievedContext}
--- END CONTEXT ---`;

    // 4. Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // 5. Stream from Gemini 1.5 Flash with native SDK
    const genAI = getGenAI();
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-lite',
      systemInstruction: systemPrompt,
    });

    // Build history in Gemini format (role: user | model)
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const chat = model.startChat({ history });
    const streamResult = await chat.sendMessageStream(latestMessage);

    for await (const chunk of streamResult.stream) {
      const text = chunk.text();
      if (text) {
        res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
    res.end();
  } catch (err) {
    console.error('[Whobee Chat Error]', err.message);

    const isRateLimit = err.message?.includes('429') || err.message?.includes('quota') || err.message?.includes('Too Many Requests');
    const friendlyMsg = isRateLimit
      ? "⚠️ I'm a bit tired right now — my AI quota has been temporarily exhausted from heavy use today! I'll be fully recharged soon. In the meantime, check the [help center](/support) or try again in a few hours! 🌙"
      : "⚠️ I ran into a connection issue. Please ensure the server is running and try again!";

    if (!res.headersSent) {
      // SSE not started — send as JSON fallback
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ text: friendlyMsg })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      res.write(`data: ${JSON.stringify({ text: friendlyMsg })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
    }
  }
});

module.exports = router;
