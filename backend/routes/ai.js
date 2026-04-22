/**
 * Retlify AI API Routes - v3 (All-Free Edition)
 * ===============================================
 * Mounts at /api/ai
 *
 * CHANGES in v3:
 *  - Removed HuggingFace and Replicate from /product-studio/providers
 *  - Updated safety check to use local filter (no HF dependency)
 *  - Added targetAudience + style params to /product-studio
 *  - All other routes preserved for backward compatibility
 */

const express   = require('express');
const rateLimit = require('express-rate-limit');
const router    = express.Router();

const {
  detectIntent, correctTypos, getAISuggestions,
  rankResults, rankResultsAsync,
  getTrendingSearches, enrichQuery,
} = require('../ai/searchService');
const { getChatResponse }            = require('../ai/chatbotService');
const { generateProductDescription } = require('../ai/descriptionService');
const { getInsights, getShopInsights, detectRisingTrends } = require('../ai/analyticsService');
const { translateQuery, detectLanguage }     = require('../ai/translationService');
const recommendations = require('../ai/recommendationService');
const behavior        = require('../ai/userBehaviorService');
const cache           = require('../ai/cacheService');
const translator      = require('../utils/translator');
const { runProductStudio }   = require('../ai/productStudioService');
// NOTE: generateImages is imported via productStudioService; importing it here
// also created a name collision with the `generateImages` field destructured
// from req.body inside /product-studio.
const { generateBatch }      = require('../ai/pollinationsService');
const { upload, processImages, handleUploadError } = require('../middleware/upload');

/* -- Rate limits -------------------------------------------- */
const chatLimit   = rateLimit({ windowMs: 60*1000, max: 20, message: { error: 'Too many requests' } });
const genLimit    = rateLimit({ windowMs: 60*1000, max: 10, message: { error: 'Too many requests' } });
const trackLimit  = rateLimit({ windowMs: 60*1000, max: 60, message: { error: 'Too many requests' } });
const studioLimit = rateLimit({ windowMs: 60*1000, max: 5,  message: { error: 'Too many studio requests. Max 5/min.' } });

function getUserId(req) {
  return req.user?.id || req.headers['x-user-id'] || req.body?.userId || null;
}

/* -- Health -------------------------------------------------- */
router.get('/health', (req, res) => {
  res.json({
    status:   'ok',
    aiEnabled: !!process.env.OPENROUTER_API_KEY,
    imageGen: 'pollinations',       // always available, no key needed
    features: [
      'search', 'chatbot', 'description', 'analytics', 'translation',
      'recommendations', 'personalization', 'trending', 'cache', 'product-studio'
    ],
    cacheStats: cache.stats(),
  });
});

/* -- Search Suggestions ------------------------------------- */
router.get('/search/suggest', async (req, res) => {
  try {
    const { q = '', city = '', userId: qUserId = '' } = req.query;
    const userId = getUserId(req) || qUserId;
    if (!q.trim()) {
      const trending    = getTrendingSearches(city);
      // FIX: behavior.getProfile is async - await it (was previously a Promise)
      const userProfile = userId ? await behavior.getProfile(userId) : null;
      return res.json({ suggestions: [], trending, recentSearches: userProfile?.recentSearches || [], intent: null });
    }
    const { translated }  = await translateQuery(q);
    const corrected       = correctTypos(translated);
    const intent          = detectIntent(corrected);
    // FIX: behavior.getProfile is async - await it (was previously a Promise)
    const userProfile     = userId ? await behavior.getProfile(userId) : null;
    const userContext     = { city, userId, recentSearches: userProfile?.recentSearches || [], topCategories: userProfile?.topCategories || [] };
    const suggestions     = await getAISuggestions(corrected, userContext);
    const trending        = getTrendingSearches(city);
    if (userId) behavior.trackSearch(userId, q, { city });
    res.json({ suggestions, trending, recentSearches: userProfile?.recentSearches?.slice(-5) || [], intent, corrected: corrected !== q.toLowerCase() ? corrected : null, translated: translated !== q ? translated : null });
  } catch (err) {
    console.error('[AI Search]', err.message);
    res.status(500).json({ error: 'Search service unavailable' });
  }
});

/* -- Search Parse -------------------------------------------- */
router.post('/search/parse', async (req, res) => {
  try {
    const { query = '', city = '' } = req.body;
    const { translated, language } = await translateQuery(query);
    const corrected = correctTypos(translated);
    const intent    = detectIntent(corrected);
    res.json({ original: query, translated, corrected, language, intent });
  } catch (err) {
    res.status(500).json({ error: 'Parse failed' });
  }
});

/* -- Search Enrich ------------------------------------------- */
router.post('/search/enrich', async (req, res) => {
  try {
    const { query = '', results = [] } = req.body;
    const userId = getUserId(req) || req.body.userId;
    const { translated } = await translateQuery(query);
    const enriched       = enrichQuery(translated);
    const ranked         = results.length ? await rankResultsAsync(results, enriched._internal, userId) : [];
    if (userId && query.trim()) behavior.trackSearch(userId, query).catch(() => {});
    res.json({ query: enriched.query, corrected: enriched.corrected, intent: enriched.intent, results: ranked });
  } catch (err) {
    console.error('[AI Search Enrich]', err.message);
    res.status(500).json({ error: 'Search enrichment failed' });
  }
});

/* -- Search Rank --------------------------------------------- */
router.post('/search/rank', async (req, res) => {
  try {
    const { query = '', results = [] } = req.body;
    const userId         = getUserId(req) || req.body.userId;
    const { translated } = await translateQuery(query);
    const corrected      = correctTypos(translated);
    const intent         = detectIntent(corrected);
    const ranked         = await rankResultsAsync(results, intent, userId);
    res.json({ ranked, intent });
  } catch (err) {
    res.status(500).json({ error: 'Ranking failed' });
  }
});

/* -- Chatbot ------------------------------------------------- */
router.post('/chat', chatLimit, async (req, res) => {
  try {
    const { messages = [], mode = 'customer', context = {} } = req.body;
    const userId = getUserId(req) || req.body.userId;
    if (!messages.length) return res.status(400).json({ error: 'Messages array required' });
    if (userId) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.content) behavior.trackChatbotQuery(userId, lastUserMsg.content).catch(() => {});
    }
    const result = await getChatResponse(messages, mode, context, userId);
    res.json(result);
  } catch (err) {
    console.error('[AI Chat]', err.message);
    res.status(500).json({ error: 'Chatbot unavailable' });
  }
});

/* -- Product Description Generator ------------------------- */
router.post('/describe', genLimit, async (req, res) => {
  try {
    const { productName, category, features = [], language = 'en' } = req.body;
    if (!productName || !category) return res.status(400).json({ error: 'productName and category required' });
    const result = await generateProductDescription({ productName, category, features, language });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Description generation unavailable' });
  }
});

/* -- AI Insights --------------------------------------------- */
router.post('/insights', async (req, res) => {
  try {
    const { city = '', categories = [], searchLogs = [], salesData = null } = req.body;
    const result = await getInsights({ city, categories, searchLogs, salesData });
    res.json(result);
  } catch (err) {
    console.error('[Insights]', err.message);
    res.status(500).json({ error: 'Analytics unavailable' });
  }
});

/* -- Translation --------------------------------------------- */
router.post('/translate', async (req, res) => {
  try {
    const { query = '' } = req.body;
    const detected = translator.detect(query);
    const result   = await translateQuery(query);
    res.json({ ...result, detectedLanguage: detected.language, script: detected.script, confidence: detected.confidence, needsAI: detected.needsAI });
  } catch (err) {
    res.status(500).json({ error: 'Translation failed' });
  }
});

/* -- User Behavior Tracking --------------------------------- */
router.post('/user/track', trackLimit, (req, res) => {
  try {
    const userId = getUserId(req) || req.body.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    const { type, query, product, durationMs, city, location } = req.body;
    switch (type) {
      case 'search':   behavior.trackSearch(userId, query, { city }); break;
      case 'click':    behavior.trackClick(userId, product); break;
      case 'view':     behavior.trackView(userId, product, durationMs); break;
      case 'purchase': behavior.trackPurchase(userId, product); break;
      case 'location': behavior.updateLocation(userId, location); break;
      default: return res.status(400).json({ error: 'Unknown event type' });
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Tracking failed' });
  }
});

/* -- Batch Sync ---------------------------------------------- */
router.post('/user/sync', trackLimit, (req, res) => {
  try {
    const userId = getUserId(req) || req.body.userId;
    const { events = [] } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    behavior.batchSync(userId, events);
    res.json({ success: true, synced: events.length });
  } catch (err) {
    res.status(500).json({ error: 'Sync failed' });
  }
});

/* -- User Profile -------------------------------------------- */
router.get('/user/profile', async (req, res) => {
  try {
    const userId = getUserId(req) || req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId required' });
    // FIX: behavior.getProfile is async - handler must be async and await
    const profile = await behavior.getProfile(userId);
    if (!profile) return res.json({ userId, isEmpty: true });
    res.json(profile);
  } catch (err) {
    res.status(500).json({ error: 'Profile fetch failed' });
  }
});

/* -- Recommendations ----------------------------------------- */
router.post('/recommendations', async (req, res) => {
  try {
    const { city = '', query = '' } = req.body;
    const userId = getUserId(req) || req.body.userId;
    const bundle = await recommendations.getRecommendationsBundle(userId, { city, query });
    res.json(bundle);
  } catch (err) {
    console.error('[Recommendations]', err.message);
    res.status(500).json({ error: 'Recommendations unavailable' });
  }
});

/* -- Trending ------------------------------------------------ */
router.get('/recommendations/trending', async (req, res) => {
  try {
    const { city = '', limit = '6' } = req.query;
    const result = await recommendations.getTrendingNearYou(city, { limit: parseInt(limit, 10) });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Trending fetch failed' });
  }
});

/* -- Trend Detection ----------------------------------------- */
router.post('/trends/detect', async (req, res) => {
  try {
    const { city = '' } = req.body;
    // FIX: both calls are async - were returning unresolved Promises
    const [alerts, stats] = await Promise.all([
      detectRisingTrends(city),
      behavior.getGlobalSearchStats(),
    ]);
    res.json({ alerts, stats, city: city || 'India', detectedAt: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: 'Trend detection failed' });
  }
});

/* -- Cache Stats --------------------------------------------- */
router.get('/cache/stats', (req, res) => {
  res.json(cache.stats());
});

/* ------------------------------------------------------------ */
/*  AI PRODUCT STUDIO  (v3 - Pollinations-powered)             */
/* ------------------------------------------------------------ */

// POST /api/ai/product-studio
router.post(
  '/product-studio',
  studioLimit,
  upload.array('images', 5),
  handleUploadError,
  processImages,
  async (req, res) => {
    try {
      const {
        productName    = '',
        language       = 'en',
        generateImages = 'true',
        style          = '',
        targetAudience = '',
        category       = '',
      } = req.body;

      const features = req.body.features
        ? (Array.isArray(req.body.features) ? req.body.features : [req.body.features])
        : [];

      const result = await runProductStudio({
        images:         req.files || [],
        productName,
        category,
        features,
        language,
        generateImages: generateImages !== 'false',
        style,
        targetAudience,
      });

      if (!result.success) {
        return res.status(result.safe === false ? 400 : 500).json(result);
      }

      res.json(result);
    } catch (err) {
      console.error('[Product Studio]', err.message);
      res.status(500).json({ error: 'Product Studio unavailable', details: err.message });
    }
  }
);

// GET /api/ai/product-studio/providers
router.get('/product-studio/providers', (req, res) => {
  res.json({
    openrouter:      !!process.env.OPENROUTER_API_KEY,
    imageGen:        'pollinations',  // always available
    pollinationsKey: false,           // no key required - fully free
    placeholderMode: false,           // Pollinations is always active
    safetyCheck:     'local',         // built-in, no external API
    freeMode:        true,
  });
});

// POST /api/generate-images
// Simple, direct image generation endpoint.
// Body: { prompt: string }
// Returns: { images: string[] }  - array of 4 Pollinations image URLs
const imgGenLimit = rateLimit({ windowMs: 60*1000, max: 15, message: { error: 'Too many image requests. Max 15/min.' } });

router.post('/generate-images', imgGenLimit, async (req, res) => {
  try {
    const { prompt = '' } = req.body;

    if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
      return res.status(400).json({ error: 'prompt is required and must be a non-empty string' });
    }

    const trimmedPrompt = prompt.trim().slice(0, 500); // cap prompt length

    // Generate 4 image URLs in parallel using different seeds
    const results = await generateBatch(trimmedPrompt, {
      seeds:    [1, 2, 3, 4],
      width:    1024,
      height:   1024,
      model:    'flux',
      validate: false, // skip HEAD check for speed
    });

    const images = results.map(r => r.url).filter(Boolean);

    if (!images.length) {
      return res.status(502).json({ error: 'Image generation failed. Please try again.' });
    }

    res.json({ images });
  } catch (err) {
    console.error('[generate-images]', err.message);
    res.status(500).json({ error: 'Image generation unavailable', details: err.message });
  }
});

module.exports = router;
