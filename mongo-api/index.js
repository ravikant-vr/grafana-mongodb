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
