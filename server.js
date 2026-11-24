'use strict';
// Stockroom: zero-dependency inventory + accounting server.
// Requires Node >= 22.5 (built-in node:sqlite). No API keys, no external services.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 3000;
const ON_VERCEL = Boolean(process.env.VERCEL);
// Vercel's filesystem is read-only except /tmp, which is temporary.
const DATA_DIR = process.env.DATA_DIR || (ON_VERCEL ? '/tmp/stockroom' : path.join(__dirname, 'data'));
const PASSWORD = process.env.APP_PASSWORD || ''; // optional: set to require a login
const CURRENCY = /^[A-Z]{3}$/.test(process.env.CURRENCY || '') ? process.env.CURRENCY : 'USD';
const PUBLIC_DIR = path.join(__dirname, 'public');

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'inventory.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'pcs',
    unit_cost REAL NOT NULL DEFAULT 0,
    reorder_level REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS movements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
    type TEXT NOT NULL CHECK (type IN ('in','out')),
    quantity REAL NOT NULL CHECK (quantity > 0),
    unit_value REAL NOT NULL DEFAULT 0,
    party TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_mov_item ON movements(item_id);
  CREATE INDEX IF NOT EXISTS idx_mov_date ON movements(date);
`);


// ---------- demo data (Vercel previews or DEMO_DATA=1, only when the database is empty) ----------
function seedDemo() {
  if (db.prepare('SELECT COUNT(*) AS c FROM items').get().c) return;
  const items = [
    ['Rice 25kg bag', 'FD-001', 'Food', 'bag', 24, 10],
    ['Cooking oil 5L', 'FD-002', 'Food', 'can', 11, 8],
    ['Lentils 10kg', 'FD-003', 'Food', 'bag', 15, 6],
    ['Blankets', 'HH-001', 'Household', 'pcs', 9, 20],
    ['Soap bars', 'HY-001', 'Hygiene', 'box', 6, 10],
    ['Notebooks', 'ED-001', 'Education', 'pcs', 1.2, 50],
    ['First-aid kits', 'MD-001', 'Medical', 'kit', 18, 5],
  ];
  const ins = db.prepare('INSERT INTO items (name, sku, category, unit, unit_cost, reorder_level) VALUES (?,?,?,?,?,?)');
  items.forEach((i) => ins.run(...i));
  const day = (ago) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);
  const mv = db.prepare('INSERT INTO movements (item_id, type, quantity, unit_value, party, note, date) VALUES (?,?,?,?,?,?,?)');
  [ // item, type, qty, party, note, days ago
    [1, 'in', 80, 'Green Valley Foundation', 'Quarterly donation', 62], [2, 'in', 60, 'City Wholesale', 'Purchase', 60],
    [3, 'in', 40, 'City Wholesale', 'Purchase', 60], [4, 'in', 120, 'Rotary Club', 'Winter drive', 45],
    [5, 'in', 100, 'City Wholesale', 'Purchase', 40], [6, 'in', 400, 'Book Aid', 'School term supply', 38],
    [7, 'in', 30, 'Health Dept.', 'Donation', 30],
    [1, 'out', 30, 'Riverside Community', 'Monthly distribution', 28], [2, 'out', 25, 'Riverside Community', 'Monthly distribution', 28],
    [4, 'out', 60, 'North Camp', 'Winter distribution', 21], [6, 'out', 250, 'Hope School', 'Term start', 18],
    [1, 'out', 32, 'Riverside Community', 'Monthly distribution', 9], [3, 'out', 30, 'Old Town Shelter', 'Weekly supply', 7],
    [5, 'out', 95, 'North Camp', 'Hygiene kits', 5], [2, 'out', 28, 'Old Town Shelter', 'Weekly supply', 3],
    [1, 'in', 20, 'Green Valley Foundation', 'Top-up', 2],
  ].forEach(([id, type, q, party, note, ago]) =>
    mv.run(id, type, q, items[id - 1][4], party, note, day(ago)));
}
if (ON_VERCEL || process.env.DEMO_DATA === '1') seedDemo();

// ---------- helpers ----------
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const round = (n) => Math.round(n * 1000) / 1000;
const str = (v, max = 200) => String(v ?? '').trim().slice(0, max);
const num = (v, field, { min = 0, required = false } = {}) => {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpError(400, `${field} is required`);
    return 0;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new HttpError(400, `${field} must be a number`);
  if (n < min) throw new HttpError(400, `${field} must be at least ${min}`);
  return n;
};
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const today = () => new Date().toISOString().slice(0, 10);

const STOCK_SQL = `
  SELECT i.*, ROUND(COALESCE(SUM(CASE m.type WHEN 'in' THEN m.quantity ELSE -m.quantity END), 0), 3) AS stock
  FROM items i LEFT JOIN movements m ON m.item_id = i.id`;
const getItem = (id) => db.prepare(`${STOCK_SQL} WHERE i.id = ? GROUP BY i.id`).get(id);
const stockOf = (id) => getItem(id)?.stock ?? 0;
const withValue = (r) => ({ ...r, stock_value: round(r.stock * r.unit_cost) });

function csvCell(v) {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // neutralise spreadsheet formulas
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
const toCsv = (rows, cols) =>
  [cols.join(','), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(','))].join('\r\n') + '\r\n';

// ---------- API ----------
const routes = [];
const route = (method, pattern, handler) => {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, re, keys, handler });
};

route('GET', '/api/health', () => ({ ok: true, time: new Date().toISOString() }));

route('GET', '/api/config', () => ({ currency: CURRENCY }));

route('GET', '/api/items', () =>
  db.prepare(`${STOCK_SQL} GROUP BY i.id ORDER BY i.name COLLATE NOCASE`).all().map(withValue));

function readItem(body) {
  const name = str(body.name);
  if (!name) throw new HttpError(400, 'Name is required');
  return {
    name,
    sku: str(body.sku, 60),
    category: str(body.category, 80),
    unit: str(body.unit, 20) || 'pcs',
    unit_cost: num(body.unit_cost, 'Unit cost'),
    reorder_level: num(body.reorder_level, 'Reorder level'),
  };
}

route('POST', '/api/items', ({ body }) => {
  const v = readItem(body);
  const r = db.prepare(
    'INSERT INTO items (name, sku, category, unit, unit_cost, reorder_level) VALUES (?,?,?,?,?,?)'
  ).run(v.name, v.sku, v.category, v.unit, v.unit_cost, v.reorder_level);
  return { status: 201, body: withValue(getItem(Number(r.lastInsertRowid))) };
});

route('PUT', '/api/items/:id', ({ params, body }) => {
  const id = Number(params.id);
  if (!getItem(id)) throw new HttpError(404, 'Item not found');
  const v = readItem(body);
  db.prepare('UPDATE items SET name=?, sku=?, category=?, unit=?, unit_cost=?, reorder_level=? WHERE id=?')
    .run(v.name, v.sku, v.category, v.unit, v.unit_cost, v.reorder_level, id);
  return withValue(getItem(id));
});

route('DELETE', '/api/items/:id', ({ params }) => {
  const id = Number(params.id);
  if (!getItem(id)) throw new HttpError(404, 'Item not found');
  const used = db.prepare('SELECT COUNT(*) AS c FROM movements WHERE item_id = ?').get(id).c;
  if (used) throw new HttpError(409, 'This item has recorded movements and cannot be deleted');
  db.prepare('DELETE FROM items WHERE id = ?').run(id);
  return { ok: true };
});

const MOV_SQL = `
  SELECT m.*, i.name AS item_name, i.unit AS unit, ROUND(m.quantity * m.unit_value, 2) AS total
  FROM movements m JOIN items i ON i.id = m.item_id`;

function queryMovements(q) {
  const where = [], args = [];
  if (q.item_id) { where.push('m.item_id = ?'); args.push(Number(q.item_id)); }
  if (q.type === 'in' || q.type === 'out') { where.push('m.type = ?'); args.push(q.type); }
  if (q.from && isDate(q.from)) { where.push('m.date >= ?'); args.push(q.from); }
  if (q.to && isDate(q.to)) { where.push('m.date <= ?'); args.push(q.to); }
  const sql = `${MOV_SQL} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY m.date DESC, m.id DESC`;
  return db.prepare(sql).all(...args);
}

route('GET', '/api/movements', ({ query }) => queryMovements(query));

route('POST', '/api/movements', ({ body }) => {
  const itemId = Number(body.item_id);
  const item = getItem(itemId);
  if (!item) throw new HttpError(400, 'Choose a valid item');
  const type = body.type;
  if (type !== 'in' && type !== 'out') throw new HttpError(400, 'Type must be "in" or "out"');
  const quantity = num(body.quantity, 'Quantity', { required: true });
  if (quantity <= 0) throw new HttpError(400, 'Quantity must be greater than 0');
  const date = str(body.date) || today();
  if (!isDate(date)) throw new HttpError(400, 'Date must be YYYY-MM-DD');
  const unitValue = body.unit_value === '' || body.unit_value == null ? item.unit_cost : num(body.unit_value, 'Unit value');
  if (type === 'out' && quantity > item.stock)
    throw new HttpError(409, `Only ${item.stock} ${item.unit} in stock`);
  const r = db.prepare(
    'INSERT INTO movements (item_id, type, quantity, unit_value, party, note, date) VALUES (?,?,?,?,?,?,?)'
  ).run(itemId, type, quantity, unitValue, str(body.party), str(body.note, 500), date);
  return { status: 201, body: db.prepare(`${MOV_SQL} WHERE m.id = ?`).get(Number(r.lastInsertRowid)) };
});

route('DELETE', '/api/movements/:id', ({ params }) => {
  const id = Number(params.id);
  const m = db.prepare('SELECT * FROM movements WHERE id = ?').get(id);
  if (!m) throw new HttpError(404, 'Movement not found');
  if (m.type === 'in' && stockOf(m.item_id) - m.quantity < 0)
    throw new HttpError(409, 'Deleting this entry would make stock negative');
  db.prepare('DELETE FROM movements WHERE id = ?').run(id);
  return { ok: true };
});

route('GET', '/api/summary', () => {
  const items = db.prepare(`${STOCK_SQL} GROUP BY i.id`).all().map(withValue);
  const month = today().slice(0, 7);
  const agg = db.prepare(`
    SELECT
      ROUND(COALESCE(SUM(CASE WHEN type='in'  THEN quantity*unit_value END),0),2) AS in_value,
      ROUND(COALESCE(SUM(CASE WHEN type='out' THEN quantity*unit_value END),0),2) AS out_value,
      COUNT(*) AS count
    FROM movements WHERE substr(date,1,7) = ?`).get(month);
  const low = items.filter((i) => i.reorder_level > 0 && i.stock <= i.reorder_level);
  return {
    month,
    item_count: items.length,
    stock_value: round(items.reduce((s, i) => s + i.stock_value, 0)),
    low_stock: low,
    month_in_value: agg.in_value,
    month_out_value: agg.out_value,
    month_movements: agg.count,
    recent: db.prepare(`${MOV_SQL} ORDER BY m.date DESC, m.id DESC LIMIT 8`).all(),
  };
});

route('GET', '/api/reports/monthly', () =>
  db.prepare(`
    SELECT substr(date,1,7) AS month,
      ROUND(SUM(CASE WHEN type='in'  THEN quantity*unit_value ELSE 0 END),2) AS in_value,
      ROUND(SUM(CASE WHEN type='out' THEN quantity*unit_value ELSE 0 END),2) AS out_value,
      COUNT(*) AS movements
    FROM movements GROUP BY month ORDER BY month DESC LIMIT 24`).all());

route('GET', '/api/export/items.csv', () => ({
  csv: toCsv(db.prepare(`${STOCK_SQL} GROUP BY i.id ORDER BY i.name COLLATE NOCASE`).all().map(withValue),
    ['id', 'name', 'sku', 'category', 'unit', 'unit_cost', 'reorder_level', 'stock', 'stock_value']),
  filename: 'items.csv',
}));

route('GET', '/api/export/movements.csv', ({ query }) => ({
  csv: toCsv(queryMovements(query),
    ['id', 'date', 'type', 'item_name', 'quantity', 'unit', 'unit_value', 'total', 'party', 'note']),
  filename: 'movements.csv',
}));

// ---------- HTTP plumbing ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.png': 'image/png', '.txt': 'text/plain; charset=utf-8',
};
const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'",
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}
const sendJson = (res, status, data) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

function authorised(req) {
  if (!PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const given = Buffer.from(h.slice(6), 'base64').toString();
  const pass = given.slice(given.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 1_000_000) { reject(new HttpError(413, 'Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 403, 'Forbidden');
  let target = file;
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    const page = path.join(PUBLIC_DIR, '404.html');
    return send(res, 404, req.method === 'HEAD' ? '' : fs.readFileSync(page), { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
  }
  const type = MIME[path.extname(target)] || 'application/octet-stream';
  const cache = target.endsWith('index.html') ? 'no-cache' : 'public, max-age=300';
  send(res, 200, req.method === 'HEAD' ? '' : fs.readFileSync(target), { 'Content-Type': type, 'Cache-Control': cache });
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const { pathname } = url;
    if (pathname === '/api/health') return sendJson(res, 200, { ok: true });
    if (!authorised(req))
      return send(res, 401, 'Authentication required', { 'WWW-Authenticate': 'Basic realm="Stockroom", charset="UTF-8"' });

    if (pathname.startsWith('/api/')) {
      const method = req.method;
      for (const r of routes) {
        const m = r.re.exec(pathname);
        if (!m || r.method !== method) continue;
        const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
        const body = method === 'POST' || method === 'PUT' ? await readBody(req) : {};
        const out = r.handler({ params, body, query: Object.fromEntries(url.searchParams) });
        if (out && out.csv !== undefined)
          return send(res, 200, out.csv, {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="${out.filename}"`,
            'Cache-Control': 'no-store',
          });
        if (out && out.status) return sendJson(res, out.status, out.body);
        return sendJson(res, 200, out);
      }
      const pathKnown = routes.some((r) => r.re.test(pathname));
      return sendJson(res, pathKnown ? 405 : 404, { error: pathKnown ? 'Method not allowed' : 'Not found' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
    return serveStatic(req, res, pathname);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    return sendJson(res, 500, { error: 'Something went wrong' });
  }
}
const server = http.createServer(handler);

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => console.log(`Stockroom running on port ${PORT}`));
  const stop = () => server.close(() => { db.close(); process.exit(0); });
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
module.exports = { server, handler };
