/**
 * Retlify AI Recommendation Engine
 * Generates "Recommended for you", "Trending near you", and "People also searched".
 *
 * All three feeds are personalized using:
 *   - User's search/click/view history (via userBehaviorService)
 *   - Location (city-level trending data)
 *   - Global popularity signals
 *
 * Each recommendation includes a confidence score (0-1).
 */

'use strict';

const cache        = require('./cacheService');
const behavior     = require('./userBehaviorService');

/* -- Trending product catalog per city -------------------- */
// Production: replace with real-time aggregation from search logs
const CITY_TRENDING = {
  jaipur: [
    { id: 'jp1', name: 'Rajasthani Lehenga',     category: 'clothing',    popularity: 0.95, trend: '+45%', tags: ['ethnic', 'bridal', 'festive'] },
    { id: 'jp2', name: 'Mojari Footwear',         category: 'footwear',   popularity: 0.87, trend: '+25%', tags: ['traditional', 'kolhapuri'] },
    { id: 'jp3', name: 'Silver Jewellery',        category: 'jewellery',  popularity: 0.82, trend: '+20%', tags: ['oxidised', 'handcrafted'] },
    { id: 'jp4', name: 'Blue Pottery Items',      category: 'furniture',  popularity: 0.75, trend: '+30%', tags: ['handicraft', 'decor'] },
    { id: 'jp5', name: 'Sanganeri Print Fabric',  category: 'clothing',   popularity: 0.70, trend: '+18%', tags: ['block print', 'cotton'] },
    { id: 'jp6', name: 'Running Shoes',           category: 'footwear',   popularity: 0.65, trend: '+22%', tags: ['sports', 'fitness'] },
    { id: 'jp7', name: 'Bluetooth Earphones',     category: 'electronics', popularity: 0.60, trend: '+19%', tags: ['wireless', 'budget'] },
    { id: 'jp8', name: 'Kids Ethnic Wear',        category: 'clothing',   popularity: 0.58, trend: '+35%', tags: ['kids', 'festival', 'ethnic'] },
  ],
  mumbai: [
    { id: 'mb1', name: 'Street Fashion Tops',    category: 'clothing',    popularity: 0.92, trend: '+40%', tags: ['trendy', 'casual'] },
    { id: 'mb2', name: 'Monsoon Raincoat',        category: 'clothing',   popularity: 0.88, trend: '+55%', tags: ['seasonal', 'waterproof'] },
    { id: 'mb3', name: 'Office Formals',          category: 'clothing',   popularity: 0.80, trend: '+18%', tags: ['professional', 'shirt'] },
    { id: 'mb4', name: 'Fitness Equipment',       category: 'fitness',    popularity: 0.75, trend: '+30%', tags: ['gym', 'home workout'] },
    { id: 'mb5', name: 'Budget Smartphones',      category: 'electronics', popularity: 0.72, trend: '+22%', tags: ['4G', 'android'] },
    { id: 'mb6', name: 'Fresh Organic Vegetables', category: 'grocery',   popularity: 0.68, trend: '+28%', tags: ['organic', 'healthy'] },
    { id: 'mb7', name: 'Sneakers Under 1000',   category: 'footwear',   popularity: 0.65, trend: '+35%', tags: ['budget', 'casual'] },
    { id: 'mb8', name: 'Wireless Earbuds',        category: 'electronics', popularity: 0.60, trend: '+32%', tags: ['tws', 'music'] },
  ],
  delhi: [
    { id: 'dl1', name: 'Winter Jacket',           category: 'clothing',   popularity: 0.90, trend: '+60%', tags: ['warm', 'jacket', 'seasonal'] },
    { id: 'dl2', name: 'Streetwear Hoodie',       category: 'clothing',   popularity: 0.85, trend: '+35%', tags: ['urban', 'casual'] },
    { id: 'dl3', name: 'Bridal Jewellery Set',    category: 'jewellery',  popularity: 0.83, trend: '+28%', tags: ['gold', 'bridal', 'wedding'] },
    { id: 'dl4', name: 'Electronics Accessories', category: 'electronics', popularity: 0.78, trend: '+25%', tags: ['cables', 'power bank'] },
    { id: 'dl5', name: 'Spices & Masala Box',     category: 'grocery',    popularity: 0.70, trend: '+15%', tags: ['spices', 'cooking'] },
    { id: 'dl6', name: 'Sports Shoes',            category: 'footwear',   popularity: 0.68, trend: '+28%', tags: ['running', 'gym'] },
    { id: 'dl7', name: 'Budget Headphones',       category: 'electronics', popularity: 0.64, trend: '+22%', tags: ['wired', 'music'] },
    { id: 'dl8', name: 'Kurti for Office',        category: 'clothing',   popularity: 0.60, trend: '+20%', tags: ['ethnic', 'professional'] },
  ],
  default: [
    { id: 'gn1', name: 'Running Shoes',           category: 'footwear',   popularity: 0.88, trend: '+34%', tags: ['sports', 'fitness'] },
    { id: 'gn2', name: 'Bluetooth Earphones',     category: 'electronics', popularity: 0.85, trend: '+28%', tags: ['wireless', 'music'] },
    { id: 'gn3', name: 'Ethnic Wear Kurti',       category: 'clothing',   popularity: 0.80, trend: '+22%', tags: ['ethnic', 'casual'] },
    { id: 'gn4', name: 'Kids Toys',               category: 'toys',       popularity: 0.72, trend: '+15%', tags: ['educational', 'fun'] },
    { id: 'gn5', name: 'Organic Grocery Pack',    category: 'grocery',    popularity: 0.68, trend: '+19%', tags: ['healthy', 'organic'] },
    { id: 'gn6', name: 'Budget Smartphone',       category: 'electronics', popularity: 0.65, trend: '+18%', tags: ['android', '4G'] },
    { id: 'gn7', name: 'Gold Jewellery',          category: 'jewellery',  popularity: 0.62, trend: '+12%', tags: ['gold', 'traditional'] },
    { id: 'gn8', name: 'Casual Sneakers',         category: 'footwear',   popularity: 0.60, trend: '+25%', tags: ['casual', 'daily'] },
  ],
};

/* -- People also searched (co-search graph) -------------- */
const CO_SEARCHES = {
  shoes:       ['sports socks', 'shoe polish', 'insoles', 'sneakers', 'running gear'],
  kurti:       ['dupatta', 'palazzo pants', 'ethnic jewellery', 'leggings', 'lehenga'],
  mobile:      ['mobile cover', 'screen protector', 'charger', 'earphones', 'power bank'],
  headphones:  ['aux cable', 'earphones', 'speaker', 'mobile', 'pouch'],
  saree:       ['blouse', 'petticoat', 'saree pin', 'jewellery', 'lehenga'],
  jeans:       ['shirt', 'belt', 'casual shoes', 't-shirt', 'sneakers'],
  laptop:      ['laptop bag', 'mouse', 'keyboard', 'cooling pad', 'hdmi cable'],
  grocery:     ['spices', 'dal', 'atta', 'cooking oil', 'vegetables'],
  jewellery:   ['gold ring', 'earrings', 'necklace', 'bangles', 'anklet'],
  lehenga:     ['dupatta', 'choli', 'jewellery', 'heels', 'clutch bag'],
  sneakers:    ['sports socks', 'shorts', 'gym wear', 'running shoes', 'insoles'],
  kids:        ['school bag', 'stationery', 'uniform', 'toys', 'lunch box'],
};

/* -- Helpers --------------------------------------------- */

function _computeConfidence(personalScore, popularityScore, hasUserData) {
  if (!hasUserData) return Math.round(popularityScore * 0.7 * 100) / 100;
  const combined = (personalScore * 0.6) + (popularityScore * 0.4);
  return Math.round(Math.min(0.99, combined) * 100) / 100;
}

function _dedupeById(items) {
  const seen = new Set();
  return items.filter(item => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function _cityKey(city) {
  return (city || '').toLowerCase().replace(/\s+/g, '');
}

/* -- Main recommendation functions ----------------------- */

async function getPersonalizedRecommendations(userId, { city = '', limit = 8 } = {}) {
  const cKey = cache.cacheKey('recs:personal', userId || 'anon', city);
  const cached = await cache.get(cKey);
  if (cached) return cached;

  // FIX: behavior.getProfile is async
  const profile     = userId ? await behavior.getProfile(userId) : null;
  const cityKey     = _cityKey(city);
  const allItems    = CITY_TRENDING[cityKey] || CITY_TRENDING.default;
  const hasUserData = !!profile && profile.activityLevel === 'active';

  // FIX: behavior.getUserPreferenceScore is async. Resolve all in parallel.
  const prefScores = await Promise.all(
    allItems.map(item =>
      userId ? behavior.getUserPreferenceScore(userId, item) : Promise.resolve(0)
    )
  );

  const scored = allItems.map((item, i) => {
    const prefScore  = prefScores[i] || 0;
    const confidence = _computeConfidence(prefScore, item.popularity, hasUserData);

    let personalBoost = prefScore * 0.4;

    const recentCats = profile?.searchedCategories || [];
    if (recentCats.includes(item.category)) personalBoost += 0.2;

    return {
      ...item,
      confidence,
      _rankScore: item.popularity * 0.4 + personalBoost + (hasUserData ? 0.1 : 0),
      reason: hasUserData && prefScore > 0.3
        ? `Based on your interest in ${item.category}`
        : `Popular in ${city || 'your area'}`,
    };
  });

  scored.sort((a, b) => b._rankScore - a._rankScore);

  const result = {
    items:  scored.slice(0, limit).map(({ _rankScore, ...item }) => item),
    source: hasUserData ? 'personalized' : 'popular',
    city:   city || 'India',
  };

  await cache.set(cKey, result, cache.TTL.RECOMMENDATIONS);
  return result;
}

async function getTrendingNearYou(city = '', { limit = 6 } = {}) {
  const cKey = cache.cacheKey('recs:trending', city);
  const cached = await cache.get(cKey);
  if (cached) return cached;

  const cityKey  = _cityKey(city);
  const allItems = CITY_TRENDING[cityKey] || CITY_TRENDING.default;

  const withTrend = allItems.map(item => ({
    ...item,
    trendValue: parseInt((item.trend || '0').replace('%', '').replace('+', ''), 10) || 0,
    confidence: Math.round(item.popularity * 100) / 100,
  }));

  withTrend.sort((a, b) => b.trendValue - a.trendValue);

  const result = {
    items:    withTrend.slice(0, limit),
    city:     city || 'India',
    headline: `High demand for these in ${city || 'your area'} this week`,
  };

  await cache.set(cKey, result, cache.TTL.TRENDS);
  return result;
}

async function getPeopleAlsoSearched(query = '', userId = null, { limit = 5 } = {}) {
  const cKey = cache.cacheKey('recs:also', query, userId || 'anon');
  const cached = await cache.get(cKey);
  if (cached) return cached;

  const q = query.toLowerCase();

  let coTerms = [];
  for (const [keyword, related] of Object.entries(CO_SEARCHES)) {
    if (q.includes(keyword)) {
      coTerms = related;
      break;
    }
  }

  // FIX: behavior.getProfile is async
  if (!coTerms.length && userId) {
    const profile = await behavior.getProfile(userId);
    coTerms = (profile?.recentSearches || [])
      .filter(s => s !== q)
      .slice(0, 5);
  }

  if (!coTerms.length) {
    coTerms = ['running shoes', 'budget mobile', 'kurti', 'headphones', 'grocery near me'];
  }

  const result = {
    terms:      coTerms.slice(0, limit),
    baseQuery:  query,
    confidence: coTerms.length > 2 ? 0.82 : 0.55,
  };

  await cache.set(cKey, result, cache.TTL.SUGGESTIONS);
  return result;
}

async function getRecommendationsBundle(userId, { city = '', query = '' } = {}) {
  const cKey = cache.cacheKey('recs:bundle', userId || 'anon', city);
  const cached = await cache.get(cKey);
  if (cached) return cached;

  const [personal, trending, alsoSearched] = await Promise.all([
    getPersonalizedRecommendations(userId, { city }),
    getTrendingNearYou(city),
    query ? getPeopleAlsoSearched(query, userId) : Promise.resolve(null),
  ]);

  const result = {
    recommended:  personal,
    trending,
    alsoSearched,
    generatedAt:  new Date().toISOString(),
  };

  await cache.set(cKey, result, cache.TTL.RECOMMENDATIONS);
  return result;
}

module.exports = {
  getPersonalizedRecommendations,
  getTrendingNearYou,
  getPeopleAlsoSearched,
  getRecommendationsBundle,
};
