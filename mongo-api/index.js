const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const app = express();
app.use(cors());
app.use(express.json());
// Infinity datasource (v3.x) sends POST bodies as text/plain — parse those too
app.use(express.text({ type: '*/*' }));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://root:example@mongodb:27017/?authSource=admin';
const DB_NAME = process.env.DB_NAME || 'appdb';
const PORT = process.env.PORT || 4000;

let db;

async function connect() {
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  db = client.db(DB_NAME);
  console.log('Connected to MongoDB');
}

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// List all collections
app.get('/collections', async (req, res) => {
  const cols = await db.listCollections().toArray();
  res.json(cols.map(c => c.name));
});

// Run an aggregation pipeline on any collection
// POST /aggregate/:collection
// Body: { "pipeline": [...] }
app.post('/aggregate/:collection', async (req, res) => {
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid JSON body' }); }
    }
    const pipeline = body && body.pipeline;
    if (!Array.isArray(pipeline)) {
      return res.status(400).json({ error: 'pipeline must be an array' });
    }
    const result = await db.collection(req.params.collection).aggregate(pipeline).toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Returns comparison: % return from start of period for each plan_id
// GET /returns?plan_ids=21,22,23&period=1y&format=series
app.get('/returns', async (req, res) => {
  try {
    const planIds = (req.query.plan_ids || '21,22,23').split(',').map(Number).filter(Boolean);
    const period  = req.query.period || '1y';
    const format  = req.query.format || 'series';

    const now = new Date();
    let startDate = null;
    if (period === 'ytd') {
      startDate = new Date(now.getFullYear(), 0, 1);
    } else if (period === '1m') {
      startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === '3m') {
      startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 3);
    } else if (period === '6m') {
      startDate = new Date(now); startDate.setMonth(startDate.getMonth() - 6);
    } else if (period === '1y') {
      startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 1);
    } else if (period === '3y') {
      startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 3);
    } else if (period === '5y') {
      startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 5);
    } else if (period === '10y') {
      startDate = new Date(now); startDate.setFullYear(startDate.getFullYear() - 10);
    }

    const startStr = startDate ? startDate.toISOString().split('T')[0] : null;

    const results = await Promise.all(planIds.map(async (planId) => {
      const match = startStr
        ? { plan_id: planId, as_on_date: { $gte: startStr } }
        : { plan_id: planId };
      const docs = await db.collection('funds__fund_plan_daily_navs')
        .aggregate([
          { $match: match },
          { $sort: { as_on_date: 1 } },
          { $project: { _id: 0, as_on_date: 1, nav: 1 } }
        ]).toArray();

      if (!docs.length) return { planId, data: [] };
      const baseNav = parseFloat(docs[0].nav) || 1;
      return {
        planId,
        data: docs.map(d => ({
          date: d.as_on_date,
          returnPct: parseFloat(((parseFloat(d.nav) - baseNav) / baseNav * 100).toFixed(4))
        }))
      };
    }));

    if (format === 'flat') {
      const dateMap = {};
      results.forEach(r => {
        r.data.forEach(d => {
          if (!dateMap[d.date]) dateMap[d.date] = { date: d.date };
          dateMap[d.date]['plan_' + r.planId] = d.returnPct;
        });
      });
      return res.json(Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date)));
    }

    const allDates = [...new Set(results.flatMap(r => r.data.map(d => d.date)))].sort();
    const series = results.map(r => {
      const map = {};
      r.data.forEach(d => { map[d.date] = d.returnPct; });
      return {
        planId: r.planId,
        name: 'Plan ' + r.planId,
        data: allDates.map(date => map[date] !== undefined ? map[date] : null)
      };
    });

    res.json({ period, startDate: startStr, labels: allDates, series });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Convenience: get all docs from a collection (with optional limit)
// GET /collection/:name?limit=100
app.get('/collection/:name', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const result = await db.collection(req.params.name).find({}).limit(limit).toArray();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


connect().then(() => {
  app.listen(PORT, () => console.log(`mongo-api listening on :${PORT}`));
}).catch(err => {
  console.error('Failed to connect to MongoDB:', err.message);
  process.exit(1);
});
