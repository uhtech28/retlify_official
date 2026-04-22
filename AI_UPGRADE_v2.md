# Retlify AI System — Upgrade Guide v2

## What's New

The AI system has been upgraded across 10 dimensions without breaking any existing functionality. All new modules are **additive** — the existing search, chatbot, analytics, description, and translation services continue to work exactly as before.

---

## New Files

| File | Purpose |
|------|---------|
| `backend/ai/cacheService.js` | In-memory AI response cache with TTL, LRU eviction, hit-rate metrics |
| `backend/ai/userBehaviorService.js` | User behavior tracking: searches, clicks, views, purchases → category scores |
| `backend/ai/recommendationService.js` | "Recommended for you", "Trending near you", "People also searched" |
| `frontend/ai-personalization.js` | Frontend personalization: localStorage tracking, recommendation UI, alerts |

---

## Upgraded Files

| File | Changes |
|------|---------|
| `backend/ai/searchService.js` | 4-factor ranking, cached suggestions, personalized suggestions, `rankResults()` |
| `backend/ai/chatbotService.js` | User history injection, confidence score, personalized fallbacks |
| `backend/ai/analyticsService.js` | Real-time trend detection, rising demand alerts, cache integration |
| `backend/routes/ai.js` | 6 new endpoints, userId threading, confidence passthrough |
| `frontend/ai-search.js` | Personalization patch: recent searches in dropdown, behavior tracking |
| `frontend/ai-chat.js` | Context patch: user history auto-injected into every message |

---

## New API Endpoints

```
POST /api/ai/user/track          Track a single behavior event
POST /api/ai/user/sync           Batch sync from localStorage (on login)
GET  /api/ai/user/profile        Get user's personalization profile
POST /api/ai/recommendations     Get all 3 recommendation feeds at once
GET  /api/ai/recommendations/trending?city=jaipur  Trending near you
GET  /api/ai/recommendations/also?q=shoes  People also searched
POST /api/ai/trends/detect       Real-time demand spike detection
GET  /api/ai/cache/stats         Cache performance metrics
```

### Existing endpoints upgraded (backward-compatible):
```
GET  /api/ai/search/suggest  → now returns trending + recentSearches + personalized
POST /api/ai/search/rank     → now uses 4-factor scoring (relevance/distance/popularity/userPref)
POST /api/ai/chat            → now injects user history + returns confidence score
POST /api/ai/insights        → now includes risingTrends from real behavior data
```

---

## Frontend Integration

### Minimal setup (add to `dashboard.html`):

```html
<!-- Load scripts in this order -->
<script src="ai-search.js"></script>
<script src="ai-chat.js"></script>
<script src="ai-personalization.js"></script>  <!-- NEW -->

<script>
  // Initialize personalization first
  RetlifyPersonalization.init({
    userId: currentUser?.id || null,   // from your auth session
    city:   'Jaipur',                  // user's city
    mode:   'customer',                // 'customer' | 'shopkeeper'

    // Where to inject "Recommended for you" + "Trending near you"
    recommendationsTarget: '#main-content',

    // Where to inject demand spike alerts
    alertsTarget: '#alerts-container',

    // Upgrade this search input's dropdown
    searchSelector: '#search-input',
  });

  // Init search (personalization auto-injects into this)
  RetlifyAISearch.init('#search-input', {
    city: 'Jaipur',
    onSearch: (q, intent) => console.log('Searching:', q, intent),
  });

  // Init chatbot (personalization auto-injects user history)
  RetlifyChat.init({
    mode: 'customer',
    context: { city: 'Jaipur' },
  });
</script>
```

### Manual behavior tracking:

```javascript
// Track a product click
RetlifyPersonalization.trackClick({ id: 'prod123', name: 'Running Shoes', category: 'footwear' });

// Track a product view (with dwell time)
RetlifyPersonalization.trackView({ id: 'prod456', name: 'Kurti' }, 8500); // 8.5 seconds

// Track a purchase
RetlifyPersonalization.trackPurchase({ id: 'prod789', name: 'Lehenga', price: 1200 });

// Inject "People also searched" after a search result
RetlifyPersonalization.injectAlsoSearched('#search-results', 'running shoes');

// Add confidence badge to any AI response element
RetlifyPersonalization.addConfidenceBadge(document.querySelector('.ai-result'), 0.87);
```

---

## Smart Ranking Formula

```
Score = (relevance × 0.4) + (distance × 0.2) + (popularity × 0.2) + (userPref × 0.2)
```

- **relevance** (0–1): keyword + synonym match against name/description/category
- **distance** (0–1): 0km → 1.0, 10km+ → 0.0 (only weighted higher when "near me" is in query)
- **popularity** (0–1): normalized rating + review count
- **userPref** (0–1): category interest score from behavior history

Price filters are applied as hard gates (items outside range return score –1000).

---

## Cache TTL Reference

| Namespace | TTL | Rationale |
|-----------|-----|-----------|
| `suggestions` | 60s | Real-time feel |
| `recommendations` | 5 min | Personalization |
| `trends` | 10 min | Slower-moving |
| `insights` | 15 min | Heavy compute |
| `description` | 1 hr | Rarely changes |
| `translation` | 24 hr | Static linguistic |

Cache stats: `GET /api/ai/cache/stats`

---

## Behavior Data Flow

```
User types "shoes"
    → frontend trackSearch('shoes')             [localStorage]
    → schedules backend sync (5s debounce)

User clicks product card
    → frontend trackClick({ name, category })    [localStorage]

On login
    → POST /api/ai/user/sync { events: [...] }   [to backend]
    → backend builds category score profile

Next search
    → GET /api/ai/search/suggest?userId=xxx
    → backend uses topCategories to personalize suggestions
    → search ranking uses userPreferenceScore from behaviorService
```

---

## AI Confidence Scores

Every AI response now includes a `confidence` field (0–1):

```json
{
  "reply": "Based on your interest in footwear, here are...",
  "confidence": 0.87,
  "model": "claude"
}
```

Recommendations also include per-item confidence:

```json
{
  "name": "Running Shoes",
  "confidence": 0.91,
  "reason": "Based on your interest in footwear"
}
```

---

## Environment Variables (no changes needed)

All existing env vars continue to work. No new variables required. The system gracefully degrades when `ANTHROPIC_API_KEY` is absent — all AI calls fall back to intelligent static responses with confidence scores.

---

## Scaling Notes

- **Cache**: Currently in-memory. Swap `cacheService.js` store for `ioredis` to scale horizontally.
- **Behavior profiles**: Currently in-memory Map. For persistence, add `MongoDB` write in `userBehaviorService._getProfile()`.
- **Recommendations**: Catalog is static JSON. Replace `CITY_TRENDING` with real-time aggregation from search logs when data volume grows.
