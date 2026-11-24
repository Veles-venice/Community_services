'use strict';
// End-to-end check of every route. Run: npm test
const os = require('node:os'), fs = require('node:fs'), path = require('node:path'), assert = require('node:assert');
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stockroom-'));
const { server } = require('./server');

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (m, p, body) => {
    const r = await fetch(base + p, { method: m, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    return { s: r.status, j, h: r.headers };
  };
  try {
    for (const p of ['/', '/index.html', '/style.css', '/app.js', '/favicon.svg', '/404.html']) {
      const r = await call('GET', p); assert.equal(r.s, 200, p);
    }
    assert.equal((await call('GET', '/nope.js')).s, 404);
    const nf = await call('GET', '/items'); assert.equal(nf.s, 404); assert.match(nf.j, /Page not found/);
    assert.equal((await call('GET', '/../server.js')).s === 200, false);
    assert.equal((await call('GET', '/api/health')).j.ok, true);
    assert.equal((await call('GET', '/api/config')).j.currency, 'USD');
    assert.equal((await call('GET', '/api/nothing')).s, 404);
    assert.equal((await call('PATCH', '/api/items')).s, 405);

    assert.equal((await call('POST', '/api/items', { name: '' })).s, 400);
    assert.equal((await call('POST', '/api/items', { name: 'X', unit_cost: 'abc' })).s, 400);
    const a = await call('POST', '/api/items', { name: 'Rice 25kg', sku: 'R1', unit: 'bag', unit_cost: 20, reorder_level: 5 });
    assert.equal(a.s, 201); const id = a.j.id; assert.equal(a.j.stock, 0);
    assert.equal((await call('PUT', `/api/items/${id}`, { name: 'Rice 25kg', unit: 'bag', unit_cost: 22, reorder_level: 5 })).j.unit_cost, 22);
    assert.equal((await call('PUT', '/api/items/999', { name: 'x' })).s, 404);

    assert.equal((await call('POST', '/api/movements', { item_id: id, type: 'out', quantity: 1 })).s, 409);
    assert.equal((await call('POST', '/api/movements', { item_id: id, type: 'in', quantity: 0 })).s, 400);
    assert.equal((await call('POST', '/api/movements', { item_id: id, type: 'bad', quantity: 1 })).s, 400);
    assert.equal((await call('POST', '/api/movements', { item_id: id, type: 'in', quantity: 1, date: 'nope' })).s, 400);
    assert.equal((await call('POST', '/api/movements', { item_id: 999, type: 'in', quantity: 1 })).s, 400);
    const inn = await call('POST', '/api/movements', { item_id: id, type: 'in', quantity: 10, unit_value: '', party: 'Donor, Inc', note: '=cmd' });
    assert.equal(inn.s, 201); assert.equal(inn.j.total, 220);
    const out = await call('POST', '/api/movements', { item_id: id, type: 'out', quantity: 7, party: 'Camp A' });
    assert.equal(out.s, 201);
    assert.equal((await call('GET', `/api/items`)).j[0].stock, 3);
    assert.equal((await call('POST', '/api/movements', { item_id: id, type: 'out', quantity: 4 })).s, 409);
    assert.equal((await call('DELETE', `/api/movements/${inn.j.id}`)).s, 409);
    assert.equal((await call('DELETE', `/api/items/${id}`)).s, 409);

    assert.equal((await call('GET', '/api/movements?type=out')).j.length, 1);
    assert.equal((await call('GET', `/api/movements?item_id=${id}`)).j.length, 2);
    const sum = await call('GET', '/api/summary');
    assert.equal(sum.j.item_count, 1); assert.equal(sum.j.low_stock.length, 1); assert.equal(sum.j.stock_value, 66);
    assert.equal((await call('GET', '/api/reports/monthly')).j.length, 1);
    const csv = await call('GET', '/api/export/movements.csv');
    assert.match(csv.h.get('content-type'), /text\/csv/); assert.match(csv.j, /'=cmd/); assert.match(csv.j, /"Donor, Inc"/);
    assert.match((await call('GET', '/api/export/items.csv')).j, /Rice 25kg/);

    assert.equal((await call('DELETE', `/api/movements/${out.j.id}`)).s, 200);
    assert.equal((await call('DELETE', `/api/movements/${inn.j.id}`)).s, 200);
    assert.equal((await call('DELETE', `/api/items/${id}`)).s, 200);
    assert.equal((await call('DELETE', `/api/items/${id}`)).s, 404);
    console.log('All checks passed');
    process.exit(0);
  } catch (e) { console.error('FAIL', e); process.exit(1); }
});
