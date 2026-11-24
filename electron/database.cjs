
const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

let db;

function initDatabase(userData) {
  const folder = path.join(userData, "data");
  fs.mkdirSync(folder, { recursive: true });

  db = new Database(path.join(folder, "kirana.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");

  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE,
      category TEXT DEFAULT 'General',
      unit TEXT DEFAULT 'piece',
      pack_size REAL DEFAULT 1,
      cost_price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      mrp REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 5,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      total REAL NOT NULL,
      payment_method TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      cost_price REAL NOT NULL,
      FOREIGN KEY(sale_id) REFERENCES sales(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier TEXT,
      total REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY(purchase_id) REFERENCES purchases(id),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      description TEXT NOT NULL,
      amount REAL NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_sales_date
      ON sales(created_at);

    CREATE INDEX IF NOT EXISTS idx_purchases_date
      ON purchases(created_at);
  `);
}

function getDashboard() {
  const today = new Date().toLocaleDateString("en-CA");

  const sales = db.prepare(`
    SELECT COALESCE(SUM(total), 0) AS total
    FROM sales WHERE date(created_at, 'localtime') = ?
  `).get(today).total;

  const expenses = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM expenses WHERE date(created_at, 'localtime') = ?
  `).get(today).total;

  const stock = db.prepare(`
    SELECT COUNT(*) AS count FROM products
  `).get().count;

  const lowStock = db.prepare(`
    SELECT COUNT(*) AS count FROM products
    WHERE stock <= min_stock
  `).get().count;

  const profit = db.prepare(`
    SELECT COALESCE(SUM(
      si.quantity * (si.price - si.cost_price)
    ), 0) AS total
    FROM sale_items si
    JOIN sales s ON s.id = si.sale_id
    WHERE date(s.created_at, 'localtime') = ?
  `).get(today).total;

  return { sales, expenses, stock, lowStock, profit };
}

function getProducts() {
  return db.prepare(`
    SELECT * FROM products ORDER BY name COLLATE NOCASE
  `).all();
}

function saveProduct(p) {
  if (!p.name?.trim()) throw new Error("Product name is required.");

  const values = [
    p.name.trim(),
    p.barcode || null,
    p.category || "General",
    p.unit || "piece",
    Number(p.pack_size || 1),
    Number(p.cost_price || 0),
    Number(p.selling_price || 0),
    Number(p.mrp || 0),
    Number(p.stock || 0),
    Number(p.min_stock || 5)
  ];

  if (p.id) {
    db.prepare(`
      UPDATE products SET
        name=?, barcode=?, category=?, unit=?, pack_size=?,
        cost_price=?, selling_price=?, mrp=?, stock=?, min_stock=?
      WHERE id=?
    `).run(...values, p.id);
  } else {
    db.prepare(`
      INSERT INTO products (
        name, barcode, category, unit, pack_size,
        cost_price, selling_price, mrp, stock, min_stock
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(...values);
  }

  return getProducts();
}

function createSale({ items, payment_method }) {
  if (!items?.length) throw new Error("Add at least one product.");

  return db.transaction(() => {
    let total = 0;
    const prepared = [];

    for (const item of items) {
      const product = db.prepare(
        "SELECT * FROM products WHERE id=?"
      ).get(item.product_id);

      if (!product) throw new Error("Product not found.");

      const quantity = Number(item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) {
        throw new Error("Invalid sale quantity.");
      }

      if (product.stock < quantity) {
        throw new Error(`Insufficient stock: ${product.name}`);
      }

      const price = product.selling_price;
      total += quantity * price;

      prepared.push({
        ...product,
        quantity,
        price
      });
    }

    const sale = db.prepare(`
      INSERT INTO sales (total, payment_method)
      VALUES (?, ?)
    `).run(total, payment_method || "Cash");

    const insertItem = db.prepare(`
      INSERT INTO sale_items
      (sale_id, product_id, quantity, price, cost_price)
      VALUES (?, ?, ?, ?, ?)
    `);

    const updateStock = db.prepare(`
      UPDATE products SET stock = stock - ? WHERE id = ?
    `);

    for (const item of prepared) {
      insertItem.run(
        sale.lastInsertRowid,
        item.id,
        item.quantity,
        item.price,
        item.cost_price
      );

      updateStock.run(item.quantity, item.id);
    }

    return { id: sale.lastInsertRowid, total };
  })();
}

function createPurchase({ supplier, items }) {
  if (!items?.length) throw new Error("Add purchase items.");

  return db.transaction(() => {
    let total = 0;
    const prepared = [];

    for (const item of items) {
      const product = db.prepare(
        "SELECT * FROM products WHERE id=?"
      ).get(item.product_id);

      if (!product) throw new Error("Product not found.");

      const quantity = Number(item.quantity);
      const price = Number(item.price);

      if (!Number.isFinite(quantity) || quantity <= 0 ||
          !Number.isFinite(price) || price < 0) {
        throw new Error("Invalid purchase quantity or price.");
      }

      total += quantity * price;
      prepared.push({ ...product, quantity, price });
    }

    const purchase = db.prepare(`
      INSERT INTO purchases (supplier, total)
      VALUES (?, ?)
    `).run(supplier || "General Supplier", total);

    for (const item of prepared) {
      db.prepare(`
        INSERT INTO purchase_items
        (purchase_id, product_id, quantity, price)
        VALUES (?, ?, ?, ?)
      `).run(
        purchase.lastInsertRowid,
        item.id,
        item.quantity,
        item.price
      );

      const newStock = item.stock + item.quantity;
      const newCost = (
        item.stock * item.cost_price +
        item.quantity * item.price
      ) / newStock;

      db.prepare(`
        UPDATE products
        SET stock=?, cost_price=?
        WHERE id=?
      `).run(newStock, newCost, item.id);
    }

    return { id: purchase.lastInsertRowid, total };
  })();
}

function addExpense({ description, amount }) {
  if (!description?.trim()) throw new Error("Enter an expense description.");

  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("Invalid expense amount.");
  }

  return db.prepare(`
    INSERT INTO expenses (description, amount)
    VALUES (?, ?)
  `).run(description.trim(), value).lastInsertRowid;
}

function getRecentSales() {
  return db.prepare(`
    SELECT id, total, payment_method, created_at
    FROM sales ORDER BY id DESC LIMIT 20
  `).all();
}


function getReport() {
  return db.prepare(`
    SELECT
      daily.day,
      daily.sales,
      COALESCE(profits.profit, 0) AS profit
    FROM (
      SELECT
        date(created_at, 'localtime') AS day,
        SUM(total) AS sales
      FROM sales
      GROUP BY date(created_at, 'localtime')
    ) daily
    LEFT JOIN (
      SELECT
        date(s.created_at, 'localtime') AS day,
        SUM(si.quantity * (si.price - si.cost_price)) AS profit
      FROM sales s
      JOIN sale_items si ON si.sale_id = s.id
      GROUP BY date(s.created_at, 'localtime')
    ) profits ON daily.day = profits.day
    ORDER BY daily.day DESC
    LIMIT 30
  `).all();
}


function backupDatabase(destination) {
  return db.backup(destination);
}

module.exports = {
  initDatabase,
  getDashboard,
  getProducts,
  saveProduct,
  createSale,
  createPurchase,
  addExpense,
  getRecentSales,
  getReport,
  backupDatabase
};

