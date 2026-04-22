# Retlify Scaling Guide — 10k+ DAU

This codebase has been upgraded to handle 10,000+ daily active users on Render, Railway, or Fly.io. Here's what changed, why, and how to deploy.

## What changed

**Cluster mode.** `backend/cluster.js` forks one Node worker per CPU core, so a 2-vCPU container runs 2 processes instead of 1. Doubles throughput at zero infra cost.

**Redis-backed cache.** `backend/config/redis.js` + `backend/ai/cacheService.js` now use Redis when `REDIS_URL` is set. Multiple app instances share the cache instead of each maintaining its own (which would waste memory and miss frequently). Falls back to in-memory automatically if Redis is unreachable.

**Redis-backed rate limiting.** `backend/middleware/rateLimit.js` uses Redis for coherent per-IP limits across all instances. Without this, a user hitting an N-instance cluster effectively gets N× the rate limit.

**Tuned Mongo pool.** `maxPoolSize: 50` (was Mongoose default of 5). At 10k DAU you'll see spikes of 20–40 concurrent DB ops; the old pool would queue them and add latency.

**Graceful shutdown.** SIGTERM drains in-flight requests for 10s before closing Mongo and Redis. Critical for zero-downtime deploys — without it, rolling restarts drop in-flight requests.

**AI concurrency limits.** `backend/ai/concurrencyLimiter.js` caps global in-flight requests to OpenRouter (20) and Pollinations (15). Prevents one viral moment from exhausting your API quota or triggering bans.

**Compression.** `compression()` middleware saves ~70% bandwidth on JSON responses. Significant at scale.

**Keep-alive tuning.** `keepAliveTimeout: 65s` matches most load balancer defaults (Render, AWS ALB use 60s). Without this you get occasional 502s from the LB closing before Node.

**Enhanced health checks.** `/api/health` reports Mongo + Redis status + memory + uptime. `/api/ready` is a plain readiness probe for orchestrators.

**Request timeout.** 30s cap prevents slow clients from holding sockets forever (a cheap DoS vector).

## Capacity target

| Scale              | Instances | Redis | Mongo tier | Cost/mo |
|--------------------|-----------|-------|------------|---------|
| 1k DAU             | 1×starter | — (memory) | Atlas free M0 | $7 |
| **10k DAU**        | **2×standard** | **starter** | **Atlas M10** | **~$110** |
| 50k DAU            | 4×standard | pro    | Atlas M20  | ~$350 |
| 100k+ DAU          | 6–10×pro  | pro    | Atlas M30+ | $800+ |

10k DAU typically means 300–800 concurrent users at peak. Two 2-worker instances (4 processes total) gives ~1,200 req/sec on non-AI endpoints and queues AI endpoints safely.

## Deploy: Render (recommended — simplest)

Render has a blueprint at `render.yaml`. One-click deploy:

1. Push repo to GitHub.
2. Render dashboard → New → Blueprint → select repo → Apply.
3. Render provisions the web service and a managed Redis instance, wires `REDIS_URL` automatically.
4. Set secrets in the web service's Environment tab:
   - `MONGO_URI`
   - `JWT_ACCESS_SECRET` (auto-generated)
   - `RESEND_API_KEY`
   - `OPENROUTER_API_KEY`
   - `GEMINI_API_KEY`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`
   - `SMTP_PASS`, `TO_EMAIL`
5. Deploy. Render autoscales 2–5 instances based on CPU.

First deploy: ~5 min. Rolling deploys: ~90s with zero downtime (graceful shutdown handles the handoff).

## Deploy: Fly.io

`fly.toml` is configured for 2 machines in Singapore with 1GB / 2 shared vCPUs each.

```bash
curl -L https://fly.io/install.sh | sh
fly auth login
fly launch --no-deploy           # uses existing fly.toml
fly redis create                 # managed Upstash Redis — free tier 10k cmds/day
fly secrets set \
  MONGO_URI="mongodb+srv://..." \
  JWT_ACCESS_SECRET="$(openssl rand -hex 32)" \
  RESEND_API_KEY="..." \
  OPENROUTER_API_KEY="..."
fly deploy
fly scale count 2                # 2 machines for HA
```

Fly.io's proxy handles SSL, global anycast, and automatic failover between machines. Cold start ~3s if you set `auto_stop_machines = "on"`; we default to "off" to keep them warm.

## Deploy: Railway

Railway auto-detects the `railway.json` and Dockerfile.

```bash
npm i -g @railway/cli
railway login
railway init
railway add --plugin redis       # managed Redis, $5/mo
railway up
railway variables set \
  MONGO_URI=... \
  JWT_ACCESS_SECRET=... \
  RESEND_API_KEY=...
railway redeploy
```

Set `numReplicas: 2` in `railway.json` (already done) or via `railway settings`.

## Deploy: Docker / self-host

```bash
docker build -t retlify .
docker run -d --name retlify \
  -p 5000:5000 \
  -e MONGO_URI="..." \
  -e REDIS_URL="redis://host:6379" \
  -e JWT_ACCESS_SECRET="..." \
  retlify
```

Put Nginx or Caddy in front for TLS and load balancing if you run multiple containers.

## Post-deploy checklist

- `curl https://<host>/api/health` returns `{"status":"ok","mongo":"connected","redis":"connected"}`.
- MongoDB Atlas IP allowlist includes Render/Fly outbound IPs (or set `0.0.0.0/0` if comfortable).
- Rate limits tuned for your traffic: `AI_OPENROUTER_CONCURRENCY` should be ~50% of your OpenRouter rate-limit headroom.
- Watch the `/api/ai/cache/stats` endpoint (exists in `routes/ai.js`) — hit rate >70% means cache is working.
- Set up alerts on `/api/health` returning non-200 (all three PaaS support this out of the box).

## Known bottlenecks to watch

**AI endpoints**: still the slowest path. A single product-studio call can take 8s. If you see AI latency climbing past 15s consistently, raise `AI_OPENROUTER_CONCURRENCY`; if you see 429s from OpenRouter, lower it.

**Mongo free tier**: M0 cluster caps at ~500 connections *total across all services*. With 2 instances × 50 pool = 100 connections, you're fine, but upgrading to M10 ($57/mo) gives 1500 connections and dedicated RAM — worth it past 5k DAU.

**Resend free tier**: 100 emails/day. If survey signups exceed that, upgrade to $20/mo (50k emails) or swap to SES.

**Static files**: served from the Node process. At scale, consider putting Cloudflare (free) in front — it caches `/frontend/*` globally and removes 70%+ of requests from the origin.

## What's not done (intentional)

**Job queue (BullMQ / Redis Streams)**: for truly async work like bulk image generation or weekly summary emails. Not needed at 10k DAU but add it if you build batch features.

**Observability (Prometheus / Grafana)**: Render and Fly both have built-in metrics UIs; those are enough for 10k DAU. Add Pino + Loki once you need log aggregation across instances.

**Multi-region**: keep Mongo + Redis + app in the same region for now (< 5ms intra-region latency matters more than users' distance to origin, which Cloudflare solves).
