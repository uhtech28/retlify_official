# Retlify — AI Integration Guide

## Overview

This document covers the AI features added to Retlify. All features degrade gracefully — if `ANTHROPIC_API_KEY` is not set, rule-based fallbacks kick in automatically.

---

## Architecture

```
backend/
├── ai/
│   ├── searchService.js       ← Intent detection, typo correction, synonym expansion, result ranking
│   ├── chatbotService.js      ← Customer & shopkeeper AI assistant (Claude)
│   ├── descriptionService.js  ← Product description generator
│   ├── analyticsService.js    ← Market insights & stock recommendations
│   └── translationService.js ← Hinglish/Hindi → English conversion
├── routes/
│   └── ai.js                  ← All AI API endpoints mounted at /api/ai

frontend/
├── ai-search.js               ← Smart search dropdown widget
├── ai-chat.js                 ← Floating chatbot widget
├── ai-features.js             ← Analytics panel + Description Generator UI
└── dashboard.html             ← Upgraded with AI nav, sections, and widget init
```

---

## Setup

### 1. Add API Key

```bash
# backend/.env
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Get your key at [console.anthropic.com](https://console.anthropic.com).

> **Without the key**: All features still work using built-in fallbacks. No errors thrown.

### 2. Start Server

```bash
cd backend
npm install
npm run dev
```

---

## API Reference

### `GET /api/ai/search/suggest`
Returns AI-powered search suggestions.
```
?q=cheap+shoes+near+me&city=jaipur
```
**Response:**
```json
{
  "suggestions": ["cheap running shoes near me", "..."],
  "intent": { "hasLocation": true, "priceFilter": null, "keywords": ["cheap", "shoes"] },
  "corrected": null,
  "translated": null
}
```

---

### `POST /api/ai/search/parse`
Parse intent from a query (typo correction + translation + intent).
```json
{ "query": "saste joote paas mein", "city": "jaipur" }
```

---

### `POST /api/ai/search/rank`
Rank an array of products against a query.
```json
{
  "query": "budget headphones",
  "results": [
    { "name": "Boat Rockerz", "category": "Electronics", "price": 499, "distanceKm": 0.5 }
  ]
}
```

---

### `POST /api/ai/chat`
Chat with the AI assistant.
```json
{
  "messages": [{ "role": "user", "content": "Find me cheap sneakers nearby" }],
  "mode": "customer",
  "context": { "city": "Jaipur" }
}
```

---

### `POST /api/ai/describe`
Generate a product description.
```json
{
  "productName": "Wireless Earphones",
  "category": "Electronics",
  "features": ["Bluetooth 5.0", "20hr battery", "Foldable"],
  "language": "en"
}
```
**Response:**
```json
{
  "title": "Premium Wireless Earphones — 20Hr Battery",
  "description": "...",
  "highlights": ["...", "..."],
  "seoTags": ["wireless earphones", "bluetooth", "..."],
  "callToAction": "Visit our shop today!"
}
```

---

### `POST /api/ai/insights`
Get AI market insights for a shopkeeper.
```json
{ "city": "Jaipur", "categories": ["Clothing", "Footwear"] }
```

---

### `POST /api/ai/translate`
Detect and translate Hinglish/Hindi queries.
```json
{ "query": "saste kapde paas mein" }
```
**Response:**
```json
{
  "translated": "cheap clothes nearby",
  "language": "hinglish",
  "changed": true,
  "detectedLanguage": "hinglish"
}
```

---

## Frontend Integration

### Smart Search (auto-initialized on dashboard)
```js
RetlifyAISearch.init(inputElement, {
  placeholder: 'AI Search…',
  city: 'Jaipur',
  onSearch: (query, intent) => { /* handle search */ }
});
```

### Floating Chatbot (auto-initialized on dashboard)
```js
RetlifyChat.init({
  mode: 'customer',      // or 'shopkeeper'
  context: { city: 'Jaipur', shopName: 'My Store' }
});
// Control programmatically:
RetlifyChat.open();
RetlifyChat.close();
```

### Analytics Panel
```js
RetlifyAI.initAnalytics('#container', { city: 'Jaipur', categories: ['Clothing'] });
```

### Description Generator
```js
RetlifyAI.initDescriptionGenerator('container-id');
```

---

## Features Summary

| Feature | With API Key | Without API Key |
|---|---|---|
| AI Smart Search | Claude-powered suggestions | Keyword-based suggestions |
| Typo Correction | Rule-based (always on) | Rule-based (always on) |
| Hinglish Translation | Claude + static map | Static map only |
| Chatbot | Claude responses | Curated fallback responses |
| Description Generator | Claude-generated | Template-based |
| Analytics | Claude insights | Trend data + rule-based tips |
| Intent Detection | Rule-based (always on) | Rule-based (always on) |

---

## Dashboard Navigation

4 new sections added to the dashboard sidebar under **AI FEATURES**:
- 🔍 **AI Search** — Live demo with intent/price detection
- 🤖 **AI Assistant** — Embedded chat (customer + shopkeeper modes)
- 📊 **AI Analytics** — Market insights + stock recommendations
- 🧾 **Description AI** — Product description generator

The floating chatbot (bottom-right) is active on all dashboard pages.
