const axios = require('axios');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// ─── Helper: Call Google Generative AI SDK ────────────────────────────────────
async function callGoogleAI(prompt) {
  const key = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
  if (!key) throw new Error('No GOOGLE_AI_KEY set');
  const genAI = new GoogleGenerativeAI(key);
  const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  const result = await model.generateContent(prompt);
  const response = await result.response;
  return response.text();
}

// ─── Helper: Call Gemini via RapidAPI ────────────────────────────────────────
async function callRapidAPI(key, userPrompt) {
  const response = await axios.request({
    method: 'POST',
    url: 'https://gemini-pro-ai.p.rapidapi.com/',
    headers: {
      'x-rapidapi-key': key,
      'x-rapidapi-host': 'gemini-pro-ai.p.rapidapi.com',
      'Content-Type': 'application/json',
    },
    data: { contents: [{ role: 'user', parts: [{ text: userPrompt }] }] },
    timeout: 15000,
  });
  if (typeof response.data === 'string') return response.data;
  if (response.data?.text) return response.data.text;
  if (response.data?.candidates?.[0]?.content?.parts?.[0]?.text)
    return response.data.candidates[0].content.parts[0].text;
  return JSON.stringify(response.data);
}

// ─── Master AI caller: tries SDK → RapidAPI → throws ─────────────────────────
async function callGemini(prompt) {
  // 1. Try official Google AI SDK
  try {
    return await callGoogleAI(prompt);
  } catch (sdkErr) {
    console.warn('Google AI SDK failed, falling back to RapidAPI:', sdkErr.message);
  }

  // 2. Try RapidAPI
  const rapidKey = process.env.GEMINI_RAPIDAPI_KEY;
  if (rapidKey) {
    try {
      return await callRapidAPI(rapidKey, prompt);
    } catch (rapidErr) {
      console.warn('RapidAPI also failed:', rapidErr.message);
    }
  }

  throw new Error('All AI backends unavailable');
}

// ─── Local Smart Flashcard Generator (fallback) ───────────────────────────────
function generateLocalFlashcards(topic, count, difficulty) {
  const t = topic.toLowerCase();
  const templates = [
    { q: `What is the fundamental definition of ${topic}?`, a: `${topic} is a core concept that forms the foundation of its subject area, characterized by systematic principles and structured approaches to understanding.`, difficulty: 'easy' },
    { q: `What are the key components of ${topic}?`, a: `The key components include: foundational principles, practical applications, theoretical frameworks, and real-world implementations that define ${topic}.`, difficulty: 'easy' },
    { q: `How does ${topic} differ from related concepts in its field?`, a: `${topic} is distinguished by its unique approach, specific methodologies, and distinct outcomes compared to related concepts, making it essential to understand its boundaries.`, difficulty: 'medium' },
    { q: `What are the main advantages of understanding ${topic}?`, a: `Understanding ${topic} provides competitive advantages including improved problem-solving, better decision-making, enhanced academic performance, and real-world application skills.`, difficulty: 'easy' },
    { q: `Explain the historical development of ${topic}.`, a: `${topic} evolved through significant milestones, influenced by key thinkers and practical needs, developing from basic concepts to the sophisticated understanding we have today.`, difficulty: 'medium' },
    { q: `What challenges are commonly associated with ${topic}?`, a: `Common challenges include complexity of core ideas, interdisciplinary requirements, practical implementation difficulties, and the need for continuous learning as the field evolves.`, difficulty: 'medium' },
    { q: `How is ${topic} applied in real-world scenarios?`, a: `${topic} is applied across industries through practical implementations, problem-solving frameworks, and systematic methodologies that translate theoretical knowledge into tangible outcomes.`, difficulty: 'medium' },
    { q: `What are the advanced concepts within ${topic}?`, a: `Advanced concepts include specialized sub-domains, cutting-edge research areas, complex theoretical models, and emerging applications that push the boundaries of what is possible.`, difficulty: 'hard' },
    { q: `Analyze the relationship between ${topic} and broader systemic thinking.`, a: `${topic} integrates with systemic thinking through interdependencies, feedback loops, emergent properties, and holistic frameworks that bridge micro and macro perspectives.`, difficulty: 'hard' },
    { q: `What are the ethical considerations in ${topic}?`, a: `Ethical considerations involve responsible application, equity of access, potential societal impact, data privacy (if applicable), and ensuring that advancements in ${topic} benefit humanity broadly.`, difficulty: 'medium' },
    { q: `How do you measure success or mastery in ${topic}?`, a: `Success is measured through demonstrated application, ability to solve novel problems, depth of conceptual understanding, peer recognition, and practical outcomes in relevant contexts.`, difficulty: 'hard' },
    { q: `What foundational knowledge is required before studying ${topic}?`, a: `A solid foundation in prerequisite subjects, basic logical reasoning, familiarity with related terminology, and an understanding of core principles in adjacent domains are essential.`, difficulty: 'easy' },
    { q: `Describe a key theorem or principle central to ${topic}.`, a: `A central principle establishes that the relationships within ${topic} follow predictable patterns governed by defined rules, enabling systematic analysis and reliable predictions.`, difficulty: 'hard' },
    { q: `What tools or technologies are associated with ${topic}?`, a: `Key tools include specialized software, analytical frameworks, measurement instruments, and modern technologies that enable practitioners to work effectively in ${topic}.`, difficulty: 'medium' },
    { q: `How does ${topic} contribute to innovation in its field?`, a: `${topic} drives innovation by providing foundational frameworks for new discoveries, enabling cross-disciplinary insights, and offering structured approaches to solving previously intractable problems.`, difficulty: 'hard' },
    { q: `What are common misconceptions about ${topic}?`, a: `Common misconceptions include oversimplifying complex aspects, confusing it with related but distinct concepts, and underestimating the depth of expertise required for true mastery.`, difficulty: 'medium' },
    { q: `How has ${topic} evolved with modern technology?`, a: `Modern technology has transformed ${topic} by enabling data-driven approaches, automation of routine tasks, global collaboration, and unprecedented access to information and resources.`, difficulty: 'medium' },
    { q: `What is the most important skill for someone studying ${topic}?`, a: `Critical thinking, combined with systematic problem-solving and the ability to synthesize information from multiple sources, forms the cornerstone of mastery in ${topic}.`, difficulty: 'easy' },
    { q: `Explain a complex scenario where ${topic} is applied.`, a: `In a complex real-world scenario, ${topic} is applied by first diagnosing the problem, applying relevant frameworks, iterating on solutions, and evaluating outcomes against defined success criteria.`, difficulty: 'hard' },
    { q: `What future trends are emerging in ${topic}?`, a: `Emerging trends include increased automation, AI-assisted approaches, greater interdisciplinary integration, sustainability considerations, and globalization of expertise in ${topic}.`, difficulty: 'hard' },
  ];

  // Filter by difficulty if not mixed
  let pool = difficulty === 'mixed' ? templates : templates.filter(t => t.difficulty === difficulty);
  if (pool.length === 0) pool = templates;

  // Shuffle and pick `count` items
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length)).map(card => ({
    question: card.q,
    answer: card.a,
    difficulty: card.difficulty,
  }));
}

// ─── Local Smart Quiz Generator (fallback) ────────────────────────────────────
function generateLocalQuiz(topic, count) {
  const templates = [
    {
      question: `Which of the following BEST describes the primary focus of ${topic}?`,
      options: [
        `The systematic study and application of principles related to ${topic}`,
        `A purely theoretical framework with no practical applications`,
        `An outdated discipline replaced by modern approaches`,
        `A subset of an unrelated field with tangential relevance`,
      ],
      correct: 0,
      explanation: `${topic} is best defined by its systematic study combining both theoretical foundations and practical applications.`,
    },
    {
      question: `What is a CRITICAL prerequisite for truly understanding ${topic}?`,
      options: [
        `Memorizing all terminology without understanding context`,
        `Building foundational knowledge of related core concepts`,
        `Focusing exclusively on advanced topics from the start`,
        `Avoiding practical application until theory is perfect`,
      ],
      correct: 1,
      explanation: `Building foundational knowledge is essential before advancing to complex topics in ${topic}.`,
    },
    {
      question: `Which approach leads to the BEST outcomes when studying ${topic}?`,
      options: [
        `Passive reading without active application`,
        `Isolated memorization of key terms`,
        `Active problem-solving combined with conceptual review`,
        `Relying solely on instructor-provided summaries`,
      ],
      correct: 2,
      explanation: `Active learning through problem-solving is consistently shown to produce superior outcomes in mastering ${topic}.`,
    },
    {
      question: `A student claims expertise in ${topic} after one week of study. What is most likely true?`,
      options: [
        `They have achieved genuine mastery of the fundamentals`,
        `They have surface-level familiarity but lack depth`,
        `They are fully prepared for professional application`,
        `One week is sufficient for complete proficiency`,
      ],
      correct: 1,
      explanation: `True expertise in ${topic} requires extended study, practice, and exposure to diverse problem types beyond a single week.`,
    },
    {
      question: `Which characteristic is MOST associated with advanced understanding in ${topic}?`,
      options: [
        `Ability to recall facts quickly without context`,
        `Dependence on step-by-step procedural guides`,
        `Capacity to synthesize concepts and solve novel problems`,
        `Familiarity with introductory materials only`,
      ],
      correct: 2,
      explanation: `Advanced understanding in ${topic} is marked by the ability to synthesize knowledge and apply it to new, unseen problems.`,
    },
    {
      question: `When encountering a difficult problem in ${topic}, what is the BEST first step?`,
      options: [
        `Skip it and move to easier problems`,
        `Immediately look up the answer`,
        `Analyze what is known and what principles apply`,
        `Guess randomly to save time`,
      ],
      correct: 2,
      explanation: `Systematic analysis — identifying knowns, unknowns, and applicable principles — is the most effective approach in ${topic}.`,
    },
    {
      question: `How does ${topic} most commonly impact related fields?`,
      options: [
        `It operates in complete isolation from other disciplines`,
        `It provides foundational tools and frameworks applicable across domains`,
        `Its impact is limited to academic settings only`,
        `It was relevant historically but has no modern impact`,
      ],
      correct: 1,
      explanation: `${topic} provides cross-disciplinary tools and frameworks that enhance problem-solving across many related fields.`,
    },
    {
      question: `What distinguishes an expert from a novice in ${topic}?`,
      options: [
        `Experts memorize more facts than novices`,
        `Experts work faster due to luck`,
        `Experts recognize patterns and apply principles flexibly`,
        `Novices and experts perform similarly on routine tasks`,
      ],
      correct: 2,
      explanation: `Experts in ${topic} excel due to pattern recognition and flexible application of principles learned through deliberate practice.`,
    },
    {
      question: `Which metric BEST measures true competency in ${topic}?`,
      options: [
        `Speed of memorization`,
        `Number of textbooks read`,
        `Performance on novel, unseen problems`,
        `Time spent studying per week`,
      ],
      correct: 2,
      explanation: `Competency in ${topic} is best measured by performance on novel problems, which requires genuine understanding rather than rote recall.`,
    },
    {
      question: `If a theory in ${topic} is challenged by new evidence, what should happen?`,
      options: [
        `The evidence should be ignored to preserve the theory`,
        `The theory must be revised or replaced based on evidence`,
        `The theory remains valid regardless of contradictory findings`,
        `The field should abandon all prior knowledge`,
      ],
      correct: 1,
      explanation: `Scientific and academic integrity in ${topic} demands that theories be updated or replaced when credible evidence contradicts them.`,
    },
  ];

  const shuffled = [...templates].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// ─── Extract JSON robustly ────────────────────────────────────────────────────
function extractJSON(text) {
  // Remove markdown code fences
  let cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  // Find first [ or { and extract
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch (_) { /* continue */ }
  }
  // Try entire cleaned string
  try { return JSON.parse(cleaned); } catch (_) { /* continue */ }
  return null;
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
exports.callGemini = callGemini;

exports.chat = async (req, res) => {
  try {
    const { prompt, history } = req.body;
    if (!prompt) return res.status(400).json({ message: 'Prompt is required' });

    const personaPrefix = history?.length ? '' : "You are 'StudyFriend', an intelligent AI assistant embedded in a study platform. Help students learn, summarize, and explain concepts. Be polite, concise, and use markdown formatting. User: ";
    const fullPrompt = personaPrefix + prompt;

    try {
      const text = await callGemini(fullPrompt);
      return res.json({ text });
    } catch (_) {
      return res.json({
        text: `Hey there! I'm your StudyFriend AI assistant. I'm having trouble connecting to my AI backend right now, but I'm still here to help! Make sure your **GOOGLE_AI_KEY** is set in the backend \`.env\` file. Once connected, I can help you study, summarize notes, and explain concepts in detail!`
      });
    }
  } catch (err) {
    console.error('AI Chat Error:', err.message);
    res.status(500).json({ message: 'Failed to process AI request.', error: err.message });
  }
};

// ─── Squad Tutor ──────────────────────────────────────────────────────────────
exports.squadTutor = async (req, res) => {
  try {
    const { prompt, squadName, subject } = req.body;
    if (!prompt) return res.status(400).json({ message: 'Prompt is required' });

    const context = `You are a helpful, encouraging AI Study Tutor embedded in a study squad called "${squadName}". The subject is "${subject}". Keep your answers concise, formatted in markdown, and directed at a group of students. User asks: ${prompt}`;

    try {
      const text = await callGemini(context);
      return res.json({ text });
    } catch (_) {
      return res.json({
        text: `Hey squad! I'm your AI Tutor for **${squadName || 'this group'}**. I'm temporarily offline, but I'll be back soon! Set a **GOOGLE_AI_KEY** in the backend to enable live AI tutoring for ${subject || 'your subjects'}.`
      });
    }
  } catch (err) {
    console.error('Squad Tutor Error:', err.message);
    res.status(500).json({ message: 'AI failed. Try again later.', error: err.message });
  }
};

// ─── Flashcard Generator ──────────────────────────────────────────────────────
exports.generateFlashcards = async (req, res) => {
  try {
    const { topic, count = 10, difficulty = 'mixed' } = req.body;
    if (!topic) return res.status(400).json({ message: 'Topic is required' });

    const prompt = `Generate exactly ${count} high-quality flashcards for studying: "${topic}".
Difficulty: ${difficulty}.
Return ONLY a valid JSON array with NO markdown, NO code fences, NO explanation:
[{"question":"...","answer":"...","difficulty":"easy|medium|hard"}]
Requirements:
- Questions must be academically rigorous and diverse in type (definition, application, analysis, comparison)
- Answers must be comprehensive but concise (2-4 sentences)
- Difficulty labels must accurately reflect cognitive demand
- All ${count} cards must be unique and cover different aspects of ${topic}`;

    let flashcards = null;

    try {
      const rawText = await callGemini(prompt);
      flashcards = extractJSON(rawText);
      if (!Array.isArray(flashcards) || flashcards.length === 0) flashcards = null;
    } catch (aiErr) {
      console.warn('AI unavailable for flashcards, using local generator:', aiErr.message);
    }

    // Fallback to local generator
    if (!flashcards) {
      flashcards = generateLocalFlashcards(topic, count, difficulty);
    }

    res.json({ flashcards, topic, source: flashcards ? 'ai' : 'local' });
  } catch (err) {
    console.error('Flashcard Gen Error:', err.message);
    // Even on total failure, return local flashcards
    const { topic = 'General', count = 8, difficulty = 'mixed' } = req.body;
    const flashcards = generateLocalFlashcards(topic, count, difficulty);
    res.json({ flashcards, topic, source: 'local' });
  }
};

// ─── Quiz Generator ───────────────────────────────────────────────────────────
exports.generateQuiz = async (req, res) => {
  try {
    const { topic, count = 8 } = req.body;
    if (!topic) return res.status(400).json({ message: 'Topic is required' });

    const prompt = `Generate exactly ${count} multiple-choice quiz questions for: "${topic}".
Return ONLY a valid JSON array with NO markdown, NO code fences, NO explanation:
[{"question":"...","options":["A","B","C","D"],"correct":0,"explanation":"..."}]
Requirements:
- "correct" is the 0-based index of the correct option
- All 4 options must be plausible (avoid obviously wrong distractors)
- Explanations should clarify WHY the correct answer is right
- Questions must progress from fundamental to advanced difficulty
- Cover different cognitive levels: recall, comprehension, application, analysis`;

    let quiz = null;

    try {
      const rawText = await callGemini(prompt);
      quiz = extractJSON(rawText);
      if (!Array.isArray(quiz) || quiz.length === 0) quiz = null;
    } catch (aiErr) {
      console.warn('AI unavailable for quiz, using local generator:', aiErr.message);
    }

    // Fallback to local generator
    if (!quiz) {
      quiz = generateLocalQuiz(topic, count);
    }

    res.json({ quiz, topic, source: quiz ? 'ai' : 'local' });
  } catch (err) {
    console.error('Quiz Gen Error:', err.message);
    const { topic = 'General', count = 8 } = req.body;
    const quiz = generateLocalQuiz(topic, count);
    res.json({ quiz, topic, source: 'local' });
  }
};
