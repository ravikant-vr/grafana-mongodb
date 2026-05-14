# Grafana + MongoDB Integration Stack

A Docker Compose stack built to explore and prototype **Grafana graph integrations with MongoDB** for the advisor-web fund page. The goal was to check whether Grafana can connect directly to MongoDB collections, run aggregation pipelines, and serve that data as charts — either embedded into webpages or consumed by the existing Highcharts frontend.

## Background

The advisor-web frontend uses Highcharts for all charts. Each microservice has its own MongoDB collection, and the fund page was having trouble aggregating and plotting data across them. This stack was set up to validate two approaches:

1. **Can Grafana panels be embedded as code snippets in webpages?** → Yes, via iframe embed or HTTP API
2. **Can Grafana connect directly to MongoDB collections?** → Not for free. See findings below.

## Findings

| Option | Cost | Custom Code? | Verdict |
|--------|------|-------------|---------|
| `grafana-mongodb-datasource` (official Grafana plugin) | Enterprise (paid) | No | Blocked — requires license |
| `yesoreyeram-infinity-datasource` + mongo-api (this stack) | Free | Small REST bridge | **Working** |
| MongoDB Atlas Data API + Infinity datasource | Free (Atlas only) | No | Only if on Atlas |
| MongoDB BI Connector + Grafana MySQL datasource | Free (Enterprise/Atlas only) | No | Not for Community Edition |

**Conclusion:** Grafana has no free native MongoDB support. The lightest free solution is a small REST API bridge (mongo-api) that sits inside the same Docker Compose stack.

## How It Works

```
Grafana (Infinity datasource)
    │
    │  POST http://mongo-api:4000/aggregate/{collection}
    │  Body: { "pipeline": [ ...aggregation stages... ] }
    ▼
mongo-api  (Node.js/Express, port 4000)
    │  Receives pipeline → runs it on MongoDB → returns JSON
    ▼
MongoDB  (port 27017)
    │  Executes aggregation on the target collection
    ▼
Result JSON → back to Grafana → rendered as chart
```

mongo-api is ~70 lines. It exposes one generic endpoint that accepts any MongoDB aggregation pipeline for any collection. No code changes are needed when adding new collections or queries — only the URL and pipeline body change in Grafana.

## Services & Ports

| Service          | URL                       | Notes                                          |
|------------------|---------------------------|------------------------------------------------|
| Frontend (Nginx) | http://localhost:8080     | Demo UI, live stats, API explorer — start here |
| Grafana          | http://localhost:3000     | Anonymous access enabled, no login required    |
| mongo-api        | http://localhost:4000     | REST bridge used by Grafana and the frontend   |
| Prometheus       | http://localhost:9090     | Metrics scraper                                |
| MongoDB Exporter | http://localhost:9216     | Prometheus scrape target                       |
| MongoDB          | localhost:27017           | Internal only; exposed for direct access       |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/)
- [Docker Compose](https://docs.docker.com/compose/install/)

## Quick Start

```bash
docker compose up -d
```

Wait ~30 seconds for all services to initialize (MongoDB health check + plugin install in Grafana), then open:

- **http://localhost:8080** — Frontend demo (start here)
- **http://localhost:3000** — Grafana (`admin` / `admin`)
- **http://localhost:4000/health** — mongo-api health check

Startup order is handled by Docker Compose `depends_on` health checks: MongoDB must pass its health check before mongo-api starts, and both must be up before Grafana and the frontend come online.

## Project Structure

```
grafana-mongodb/
├── docker-compose.yml
├── init-mongo.js                         # seeds appdb with sample data on first start
├── prometheus.yml                        # Prometheus scrape config (mongo_exporter target)
├── frontend/
│   ├── index.html                        # Single-page demo app (served by Nginx on :8080)
│   └── nginx.conf                        # Nginx config — serves UI, proxies /grafana-api/*
├── mongo-api/
│   ├── index.js                          # REST bridge (generic aggregation API)
│   └── package.json
└── grafana/
    └── provisioning/
        ├── datasources/
        │   └── mongodb.yml               # Infinity datasource → mongo-api
        └── dashboards/
            └── dashboards.yml            # Dashboard discovery config
```

## Data Seeding

`init-mongo.js` runs automatically on first `docker compose up` via MongoDB's `docker-entrypoint-initdb.d/` mechanism. It will **not** re-run on subsequent starts unless the volume is wiped.

### What gets seeded

Database: `appdb`

**`users`** (3 documents)
| name  | email                | active |
|-------|----------------------|--------|
| Alice | alice@example.com    | true   |
| Bob   | bob@example.com      | true   |
| Carol | carol@example.com    | false  |

**`orders`** (4 documents)
| userId | product  | qty | price | status    |
|--------|----------|-----|-------|-----------|
| alice  | Widget A | 2   | 19.99 | shipped   |
| bob    | Widget B | 1   | 49.99 | pending   |
| alice  | Widget C | 5   | 9.99  | delivered |
| carol  | Widget A | 3   | 19.99 | cancelled |

**`products`** (3 documents)
| name     | sku   | price | stock |
|----------|-------|-------|-------|
| Widget A | WGT-A | 19.99 | 100   |
| Widget B | WGT-B | 49.99 | 50    |
| Widget C | WGT-C | 9.99  | 200   |

Also creates app user: `appuser` / `apppassword` with `readWrite` on `appdb`.

### To re-seed

```bash
docker compose down -v   # wipes all volumes including MongoDB data
docker compose up -d     # init-mongo.js runs again on fresh volume
```

## Frontend (Nginx)

The frontend is a single-page demo app at **http://localhost:8080** served by Nginx (`nginx:alpine`).

### What it shows

- **Live health bar** — polls Grafana, mongo-api, and Prometheus every 30 seconds, shows green/red status dots
- **Live stats bar** — loads total orders, products, revenue, and active users directly from mongo-api
- **Method 1 — iframe embed**: Grafana panels embedded as `<iframe>` elements
- **Method 2 — Grafana HTTP API**: Chart.js bar chart fetched via Grafana's query API (proxied through Nginx to avoid CORS)
- **Method 3 — Direct mongo-api**: Two live Chart.js charts (product stock levels, revenue trend) loaded straight from mongo-api
- **API Explorer**: Interactive buttons to call mongo-api endpoints and inspect the raw JSON response

### Nginx configuration (`frontend/nginx.conf`)

```
port 80
  ├── /index.html       → serves index.html with Cache-Control: no-cache
  ├── /grafana-api/*    → proxies to grafana:3000/ (same-origin trick to bypass CORS)
  └── /*                → SPA fallback to index.html
```

The `/grafana-api/` proxy is what makes Method 2 work: the browser calls `http://localhost:8080/grafana-api/...`, Nginx forwards it to `grafana:3000` on the Docker network, and the browser never sees a cross-origin response.

## mongo-api Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET`  | `/health` | Liveness check |
| `GET`  | `/collections` | List all collections in the database |
| `GET`  | `/collection/:name` | Fetch raw documents (optional `?limit=N`) |
| `POST` | `/aggregate/:collection` | Run any aggregation pipeline |

### Example — orders by status

```bash
curl -X POST http://localhost:4000/aggregate/orders \
  -H "Content-Type: application/json" \
  -d '{"pipeline": [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]}'
```

Response:
```json
[
  { "_id": "shipped",   "count": 1 },
  { "_id": "pending",   "count": 1 },
  { "_id": "delivered", "count": 1 },
  { "_id": "cancelled", "count": 1 }
]
```

## Setting Up a Grafana Panel (Step by Step)

1. Open http://localhost:3000 → **Dashboards → New Dashboard → Add Panel**
2. Set **Data source** = `MongoDB-API` (Infinity)
3. Configure the query:
   - Type: `JSON`
   - Method: `POST`
   - URL: `http://mongo-api:4000/aggregate/orders`
   - Body: `{ "pipeline": [{ "$group": { "_id": "$status", "count": { "$sum": 1 } } }] }`
4. Under **Parsing**, add columns:
   - `_id` → String → rename to "Status"
   - `count` → Number → rename to "Count"
5. Switch visualization to **Bar chart**

To query a different collection, only change the collection name in the URL and the pipeline in the body — no code changes needed.

## Embedding Panels in a Webpage

Anonymous access is already enabled. Grafana panels can be embedded as iframes.

1. Open any panel → **Share (⋮ menu) → Embed tab**
2. Copy the generated iframe URL
3. Embed in Next.js:

```tsx
export default function FundChart() {
  return (
    <iframe
      src="http://localhost:3000/d-solo/DASHBOARD_UID/fund-overview?orgId=1&panelId=2&theme=light"
      width="100%"
      height="400"
      frameBorder="0"
    />
  );
}
```

For production, replace `localhost:3000` with your deployed Grafana URL and set up proper authentication.

## MongoDB Credentials

| Variable     | Value                    |
|--------------|--------------------------|
| Root user    | `root` / `example`       |
| App user     | `appuser` / `apppassword` |
| Database     | `appdb`                  |

Connect directly:
```bash
# Via Docker
docker exec -it mongo mongosh -u root -p example

# Via local mongosh
mongosh "mongodb://root:example@localhost:27017"
```

## Common Commands

```bash
# Start all services
docker compose up -d

# Check status
docker compose ps

# Stop all services (data preserved)
docker compose down

# Stop and wipe all volumes (triggers re-seed on next start)
docker compose down -v

# View logs
docker compose logs -f grafana
docker compose logs -f mongo-api
docker compose logs -f frontend

# Restart a single service
docker compose restart mongo-api
```

## Troubleshooting

**mongo-api shows "Failed to connect to MongoDB"**
MongoDB takes ~5–10 seconds to initialize on first start. If mongo-api exits before MongoDB is ready, restart it manually:
```bash
docker compose restart mongo-api
```

**Grafana panel shows "No data"**
- Confirm mongo-api is running: `curl http://localhost:4000/health`
- The URL in Grafana must use the Docker network name, not localhost: `http://mongo-api:4000/...`

**Frontend health dots show red**
- Wait ~30 seconds after `docker compose up -d` for all services to finish starting
- Check individual service logs: `docker compose logs -f <service>`

**Grafana shows "No data" for Prometheus panels**
- Wait ~30 seconds after startup for the first Prometheus scrape
- Verify the exporter is reachable: http://localhost:9216/metrics

**Seed data missing / need to reset**
- Run `docker compose down -v && docker compose up -d` to wipe volumes and re-seed

**Port conflicts**
- Change the host-side port in `docker-compose.yml` (e.g. `"3001:3000"` moves Grafana to port 3001)
