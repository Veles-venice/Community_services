'use strict';
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const app = $('#app'), dlg = $('#dlg'), toastEl = $('#toast');
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let currency = 'USD';
  const money = (n) => new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(n || 0);
  const qty = (n) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n || 0);
  const today = () => new Date().toISOString().slice(0, 10);
  $('#year').textContent = new Date().getFullYear();

  async function api(path, opts = {}) {
    const res = await fetch(path, {
      method: opts.method || 'GET',
      headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    let data = null;
    try { data = await res.json(); } catch { /* non-JSON */ }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  }

  let toastTimer;
  function toast(msg, kind) {
    toastEl.className = kind === 'err' ? 'err' : '';
    toastEl.innerHTML = `<b>${kind === 'err' ? 'Error' : 'Done'}</b><span>${esc(msg)}</span>`;
    void toastEl.offsetWidth; toastEl.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), kind === 'err' ? 4500 : 2600);
  }

  // Boxy replacement for window.confirm()
  const cfm = $('#cfm');
  function confirmBox(title, text, okLabel) {
    return new Promise((resolve) => {
      cfm.innerHTML = `<form class="dlg" method="dialog"><h2 id="cfm-title">${esc(title)}</h2>
        <p class="muted cfm-text">${esc(text)}</p>
        <div class="foot-row"><button type="button" class="btn ghost" data-no>Cancel</button><button type="submit" class="btn" data-yes>${esc(okLabel)}</button></div></form>`;
      let result = false;
      $('[data-no]', cfm).addEventListener('click', () => cfm.close());
      $('form', cfm).addEventListener('submit', (e) => { e.preventDefault(); result = true; cfm.close(); });
      cfm.addEventListener('close', () => resolve(result), { once: true });
      cfm.showModal();
      $('[data-no]', cfm).focus();
    });
  }
  cfm.addEventListener('click', (e) => { if (e.target === cfm) cfm.close(); });

  // ---------- modal ----------
  function openModal(html, onSubmit) {
    dlg.innerHTML = `<form class="dlg" method="dialog" novalidate>${html}</form>`;
    const form = $('form', dlg);
    const err = $('.err', dlg);
    $('[data-cancel]', dlg).addEventListener('click', () => dlg.close());
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('[type=submit]', form);
      btn.disabled = true; err.textContent = '';
      try {
        await onSubmit(Object.fromEntries(new FormData(form)));
        dlg.close();
      } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
    });
    if (!dlg.open) dlg.showModal();
    const first = $('input:not([type=radio]), select', dlg);
    if (first) first.focus();
  }
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  const buttons = (label) => `<div class="err" role="alert"></div>
    <div class="foot-row"><button type="button" class="btn ghost" data-cancel>Cancel</button><button type="submit" class="btn">${label}</button></div>`;

  function itemForm(it) {
    it = it || {};
    return `<h2>${it.id ? 'Edit item' : 'New item'}</h2>
      <div class="field"><label for="f-name">Name</label><input id="f-name" name="name" value="${esc(it.name)}" maxlength="200" required></div>
      <div class="row">
        <div class="field"><label for="f-sku">SKU / code</label><input id="f-sku" name="sku" value="${esc(it.sku)}" maxlength="60"></div>
        <div class="field"><label for="f-cat">Category</label><input id="f-cat" name="category" value="${esc(it.category)}" maxlength="80"></div>
      </div>
      <div class="row">
        <div class="field"><label for="f-unit">Unit</label><input id="f-unit" name="unit" value="${esc(it.unit || 'pcs')}" maxlength="20" placeholder="pcs, kg, box"></div>
        <div class="field"><label for="f-cost">Unit cost</label><input id="f-cost" name="unit_cost" type="number" min="0" step="any" value="${it.unit_cost ?? 0}"></div>
      </div>
      <div class="field"><label for="f-re">Low-stock alert at</label><input id="f-re" name="reorder_level" type="number" min="0" step="any" value="${it.reorder_level ?? 0}"></div>
      ${buttons(it.id ? 'Save changes' : 'Add item')}`;
  }

  async function itemModal(it, after) {
    openModal(itemForm(it), async (v) => {
      await api(it ? `/api/items/${it.id}` : '/api/items', { method: it ? 'PUT' : 'POST', body: v });
      toast(it ? 'Item updated' : 'Item added'); after();
    });
  }

  async function movementModal(preset = {}, after) {
    const items = await api('/api/items');
    if (!items.length) { toast('Add an item first', 'err'); location.hash = '#/items'; return; }
    const t = preset.type || 'in';
    openModal(`<h2>Record movement</h2>
      <div class="field"><label>Type</label><div class="seg">
        <label><input type="radio" name="type" value="in" ${t === 'in' ? 'checked' : ''}><span>STOCK IN</span></label>
        <label><input type="radio" name="type" value="out" ${t === 'out' ? 'checked' : ''}><span>STOCK OUT</span></label></div></div>
      <div class="field"><label for="m-item">Item</label><select id="m-item" name="item_id">
        ${items.map((i) => `<option value="${i.id}" data-cost="${i.unit_cost}" ${i.id === preset.item_id ? 'selected' : ''}>${esc(i.name)} (${qty(i.stock)} ${esc(i.unit)})</option>`).join('')}</select></div>
      <div class="row">
        <div class="field"><label for="m-q">Quantity</label><input id="m-q" name="quantity" type="number" min="0" step="any" required></div>
        <div class="field"><label for="m-v">Value per unit</label><input id="m-v" name="unit_value" type="number" min="0" step="any"></div>
      </div>
      <div class="row">
        <div class="field"><label for="m-d">Date</label><input id="m-d" name="date" type="date" value="${today()}" required></div>
        <div class="field"><label for="m-p">Donor / supplier / recipient</label><input id="m-p" name="party" maxlength="200"></div>
      </div>
      <div class="field"><label for="m-n">Note</label><input id="m-n" name="note" maxlength="500"></div>
      ${buttons('Save')}`, async (v) => {
      await api('/api/movements', { method: 'POST', body: v });
      toast('Movement recorded'); after();
    });
    const sel = $('#m-item'), val = $('#m-v');
    const fill = () => { val.value = sel.selectedOptions[0].dataset.cost; };
    sel.addEventListener('change', fill); fill();
  }

  // ---------- views ----------
  const movRows = (rows, withDelete) => rows.map((m) => `<tr>
      <td class="num">${esc(m.date)}</td>
      <td><span class="tag ${m.type === 'in' ? 'fill' : ''}">${m.type === 'in' ? 'In' : 'Out'}</span></td>
      <td>${esc(m.item_name)}${m.party || m.note ? `<span class="sub">${esc([m.party, m.note].filter(Boolean).join(' · '))}</span>` : ''}</td>
      <td class="right num">${qty(m.quantity)} ${esc(m.unit)}</td>
      <td class="right num">${money(m.total)}</td>
      ${withDelete ? `<td class="act"><button class="link" data-act="del-mov" data-id="${m.id}">Delete</button></td>` : ''}</tr>`).join('');

  const movTable = (rows, withDelete) => rows.length
    ? `<div class="tbl-wrap"><table><thead><tr><th>Date</th><th>Type</th><th>Item</th><th class="right">Quantity</th><th class="right">Value</th>${withDelete ? '<th></th>' : ''}</tr></thead><tbody>${movRows(rows, withDelete)}</tbody></table></div>`
    : '<div class="empty">No movements recorded yet.</div>';

  async function viewHome() {
    const s = await api('/api/summary');
    app.innerHTML = `
      <p class="eyebrow">Overview — ${esc(s.month)}</p>
      <div class="head"><h1>What came in.<br>What went out.</h1>
        <div class="actions"><button class="btn" data-act="mov" data-type="in">+ Stock in</button><button class="btn ghost" data-act="mov" data-type="out">− Stock out</button></div></div>
      <p class="lede">One reliable record replacing notebooks and scattered spreadsheets.</p>
      <div class="stats">
        <div class="stat"><b>${s.item_count}</b><span>Items</span></div>
        <div class="stat"><b>${money(s.stock_value)}</b><span>Stock value</span></div>
        <div class="stat"><b>${money(s.month_in_value)}</b><span>In this month</span></div>
        <div class="stat"><b>${money(s.month_out_value)}</b><span>Out this month</span></div>
      </div>
      <section class="section"><div class="section-head"><h2>Low stock</h2><span class="muted">${s.low_stock.length} item${s.low_stock.length === 1 ? '' : 's'}</span></div>
        ${s.low_stock.length ? `<div class="tbl-wrap"><table><tbody>${s.low_stock.map((i) => `<tr><td>${esc(i.name)}</td><td class="right num">${qty(i.stock)} ${esc(i.unit)} left</td><td class="right"><span class="tag fill">Low</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Nothing is running low.</div>'}
      </section>
      <section class="section"><div class="section-head"><h2>Recent movements</h2><a class="link" href="#/movements">View all</a></div>${movTable(s.recent, false)}</section>`;
  }

  async function viewItems() {
    const items = await api('/api/items');
    app.innerHTML = `
      <p class="eyebrow">01 — Catalogue</p>
      <div class="head"><h1>Items</h1><div class="actions"><a class="btn ghost" href="/api/export/items.csv" download>Export CSV</a><button class="btn" data-act="new-item">+ New item</button></div></div>
      <div class="tools"><input type="search" id="q" placeholder="Search by name, SKU or category" aria-label="Search items"></div>
      <div id="list"></div>`;
    const draw = () => {
      const q = $('#q').value.trim().toLowerCase();
      const rows = items.filter((i) => !q || [i.name, i.sku, i.category].join(' ').toLowerCase().includes(q));
      $('#list').innerHTML = rows.length ? `<div class="tbl-wrap"><table><thead><tr><th>Item</th><th>Category</th><th class="right">In stock</th><th class="right">Unit cost</th><th class="right">Value</th><th></th></tr></thead><tbody>
        ${rows.map((i) => `<tr><td>${esc(i.name)}${i.sku ? `<span class="sub">${esc(i.sku)}</span>` : ''}</td><td>${esc(i.category) || '—'}</td>
          <td class="right num">${qty(i.stock)} ${esc(i.unit)} ${i.reorder_level > 0 && i.stock <= i.reorder_level ? '<span class="tag fill">Low</span>' : ''}</td>
          <td class="right num">${money(i.unit_cost)}</td><td class="right num">${money(i.stock_value)}</td>
          <td class="act"><button class="link" data-act="rec" data-id="${i.id}">Record</button><button class="link" data-act="edit-item" data-id="${i.id}">Edit</button><button class="link" data-act="del-item" data-id="${i.id}">Delete</button></td></tr>`).join('')}
        </tbody></table></div>` : `<div class="empty">${items.length ? 'No items match your search.' : 'No items yet. Add your first item to begin.'}</div>`;
    };
    $('#q').addEventListener('input', draw); draw();
    app._items = items;
  }

  async function viewMovements() {
    const items = await api('/api/items');
    app.innerHTML = `
      <p class="eyebrow">02 — Ledger</p>
      <div class="head"><h1>Movements</h1><div class="actions"><a class="btn ghost" id="exp" href="/api/export/movements.csv" download>Export CSV</a><button class="btn" data-act="mov" data-type="in">+ Record</button></div></div>
      <div class="tools">
        <select id="f-type" aria-label="Type"><option value="">All types</option><option value="in">Stock in</option><option value="out">Stock out</option></select>
        <select id="f-item" aria-label="Item"><option value="">All items</option>${items.map((i) => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select>
        <input type="date" id="f-from" aria-label="From date"><input type="date" id="f-to" aria-label="To date">
      </div><div id="list"></div>`;
    const load = async () => {
      const p = new URLSearchParams();
      for (const [k, id] of [['type', 'f-type'], ['item_id', 'f-item'], ['from', 'f-from'], ['to', 'f-to']]) { const v = $('#' + id).value; if (v) p.set(k, v); }
      $('#exp').href = '/api/export/movements.csv?' + p;
      $('#list').innerHTML = movTable(await api('/api/movements?' + p), true);
    };
    ['f-type', 'f-item', 'f-from', 'f-to'].forEach((id) => $('#' + id).addEventListener('change', () => load().catch((e) => toast(e.message, 'err'))));
    await load();
  }

  async function viewReports() {
    const [months, items] = await Promise.all([api('/api/reports/monthly'), api('/api/items')]);
    app.innerHTML = `
      <p class="eyebrow">03 — Accounts</p>
      <div class="head"><h1>Reports</h1><div class="actions"><button class="btn ghost" data-act="print">Print</button></div></div>
      <p class="lede">Monthly value received and distributed, and current stock position.</p>
      <section><div class="section-head"><h2>By month</h2></div>
        ${months.length ? `<div class="tbl-wrap"><table><thead><tr><th>Month</th><th class="right">Movements</th><th class="right">In</th><th class="right">Out</th><th class="right">Net</th></tr></thead><tbody>
        ${months.map((m) => `<tr><td class="num">${esc(m.month)}</td><td class="right num">${m.movements}</td><td class="right num">${money(m.in_value)}</td><td class="right num">${money(m.out_value)}</td><td class="right num">${money(m.in_value - m.out_value)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No data yet.</div>'}</section>
      <section class="section"><div class="section-head"><h2>Stock position</h2><span class="muted">Total ${money(items.reduce((s, i) => s + i.stock_value, 0))}</span></div>
        ${items.length ? `<div class="tbl-wrap"><table><thead><tr><th>Item</th><th class="right">In stock</th><th class="right">Unit cost</th><th class="right">Value</th></tr></thead><tbody>
        ${items.map((i) => `<tr><td>${esc(i.name)}</td><td class="right num">${qty(i.stock)} ${esc(i.unit)}</td><td class="right num">${money(i.unit_cost)}</td><td class="right num">${money(i.stock_value)}</td></tr>`).join('')}
        </tbody></table></div>` : '<div class="empty">No items yet.</div>'}</section>`;
  }

  function view404() {
    app.innerHTML = `<p class="eyebrow">404</p><h1>Page not found.</h1><p class="lede">That page doesn't exist.</p><a class="btn" href="#/">Back to overview</a>`;
  }

  // ---------- router ----------
  const views = { '': viewHome, items: viewItems, movements: viewMovements, reports: viewReports };
  async function render() {
    const key = location.hash.replace(/^#\/?/, '').split('?')[0].replace(/\/$/, '');
    document.querySelectorAll('nav a').forEach((a) => a.classList.toggle('on', a.dataset.route === key));
    $('#nav').classList.remove('open'); $('#menuBtn').setAttribute('aria-expanded', 'false');
    if (dlg.open) dlg.close();
    if (cfm.open) cfm.close();
    const v = views[key];
    try {
      if (v) await v(); else view404();
    } catch (e) {
      app.innerHTML = `<p class="eyebrow">Error</p><h1>Something went wrong.</h1><p class="lede">${esc(e.message)}</p><button class="btn" data-act="reload">Try again</button>`;
    }
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', render);

  // ---------- actions ----------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act, id = Number(el.dataset.id);
    const items = app._items || [];
    try {
      if (act === 'reload') render();
      else if (act === 'print') window.print();
      else if (act === 'new-item') itemModal(null, render);
      else if (act === 'edit-item') itemModal(items.find((i) => i.id === id), render);
      else if (act === 'rec') movementModal({ item_id: id }, render);
      else if (act === 'mov') movementModal({ type: el.dataset.type }, render);
      else if (act === 'del-item') {
        if (!(await confirmBox('Delete item?', 'This permanently removes the item from your catalogue.', 'Delete'))) return;
        await api(`/api/items/${id}`, { method: 'DELETE' }); toast('Item deleted'); render();
      } else if (act === 'del-mov') {
        if (!(await confirmBox('Delete movement?', 'This entry will be removed from the ledger and stock will be recalculated.', 'Delete'))) return;
        await api(`/api/movements/${id}`, { method: 'DELETE' }); toast('Movement deleted'); render();
      }
    } catch (ex) { toast(ex.message, 'err'); }
  });
  $('#menuBtn').addEventListener('click', () => {
    const open = $('#nav').classList.toggle('open');
    $('#menuBtn').setAttribute('aria-expanded', String(open));
  });

  api('/api/config').then((c) => { currency = c.currency; }).catch(() => {}).finally(render);
})();
