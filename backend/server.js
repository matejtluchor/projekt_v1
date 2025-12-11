// backend/server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// -----------------------------------------------------
//  LOGGING
// -----------------------------------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------------------------------
//  DB CONNECT
// -----------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// -----------------------------------------------------
//  DB INIT
// -----------------------------------------------------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      identifier TEXT UNIQUE,
      credit INTEGER DEFAULT 0,
      password_hash TEXT,
      role TEXT DEFAULT 'user',
      reset_token TEXT,
      reset_expires TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS foods (
      id SERIAL PRIMARY KEY,
      name TEXT,
      price INTEGER
    );

    CREATE TABLE IF NOT EXISTS menu (
      id SERIAL PRIMARY KEY,
      date TEXT,
      foodId INTEGER REFERENCES foods(id),
      maxCount INTEGER,
      ordered INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS orders (
      id SERIAL PRIMARY KEY,
      userId INTEGER REFERENCES users(id),
      date TEXT,
      itemNames TEXT,
      price INTEGER,
      status TEXT DEFAULT 'ok'
    );

    CREATE TABLE IF NOT EXISTS topups (
      id SERIAL PRIMARY KEY,
      userId INTEGER REFERENCES users(id),
      amount INTEGER,
      done INTEGER DEFAULT 0
    );
  `);

  // Create admin + manager if missing
  const seeded = [
    { identifier: "admin", password: "1973", role: "admin" },
    { identifier: "manager", password: "123", role: "manager" },
  ];

  for (const u of seeded) {
    const hash = await bcrypt.hash(u.password, 10);
    const exists = await pool.query("SELECT id FROM users WHERE identifier = $1", [u.identifier]);

    if (exists.rowCount > 0) {
      await pool.query(
        "UPDATE users SET role = $1, password_hash = $2 WHERE id = $3",
        [u.role, hash, exists.rows[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO users (identifier, password_hash, role, credit) VALUES ($1, $2, $3, 0)",
        [u.identifier, hash, u.role]
      );
    }
  }

  console.log("✅ DB inicializována");
}

// -----------------------------------------------------
//  ROLE MIDDLEWARE
// -----------------------------------------------------
function requireRole(roles) {
  return (req, res, next) => {
    const role = req.headers["x-role"];
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ success: false, error: "Nedostatečná oprávnění" });
    }
    next();
  };
}

// -----------------------------------------------------
//  REGISTRACE
// -----------------------------------------------------
app.post("/api/register", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.json({ success: false, error: "Vyplň jméno i heslo." });
    }

    if (["admin", "manager"].includes(identifier.toLowerCase())) {
      return res.json({ success: false, error: "Toto jméno je rezervováno." });
    }

    const exists = await pool.query("SELECT id FROM users WHERE identifier = $1", [identifier]);
    if (exists.rowCount > 0) {
      return res.json({ success: false, error: "Uživatel už existuje." });
    }

    const hash = await bcrypt.hash(password, 10);
    const inserted = await pool.query(
      "INSERT INTO users (identifier, password_hash, role, credit) VALUES ($1, $2, 'user', 0) RETURNING id, identifier, role, credit",
      [identifier, hash]
    );

    const u = inserted.rows[0];
    res.json({ success: true, userId: u.id, identifier: u.identifier, credit: u.credit, role: u.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false });
  }
});

// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const r = await pool.query("SELECT * FROM users WHERE identifier = $1", [identifier]);
    if (r.rowCount === 0) return res.json({ success: false, error: "Uživatel neexistuje." });

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash || "");
    if (!ok) return res.json({ success: false, error: "Špatné heslo." });

    res.json({
      success: true,
      userId: u.id,
      credit: u.credit,
      role: u.role,
      identifier: u.identifier,
    });
  } catch (err) {
    console.error(err);
    res.json({ success: false });
  }
});

// -----------------------------------------------------
//  RESET HESLA — NOVINKA
// -----------------------------------------------------
app.post("/api/reset/request", async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.json({ success: false, error: "Chybí jméno." });

    const token = crypto.randomBytes(10).toString("hex");
    const expires = new Date(Date.now() + 30 * 60 * 1000);

    await pool.query(
      "UPDATE users SET reset_token = $1, reset_expires = $2 WHERE identifier = $3",
      [token, expires, identifier]
    );

    res.json({ success: true, token, expires });
  } catch (err) {
    res.json({ success: false });
  }
});

app.post("/api/reset/confirm", async (req, res) => {
  try {
    const { identifier, token, newPassword } = req.body;

    const r = await pool.query(
      "SELECT * FROM users WHERE identifier = $1 AND reset_token = $2",
      [identifier, token]
    );

    if (r.rowCount === 0) return res.json({ success: false, error: "Neplatný token." });

    const u = r.rows[0];
    if (new Date(u.reset_expires) < new Date())
      return res.json({ success: false, error: "Token vypršel." });

    const hash = await bcrypt.hash(newPassword, 10);

    await pool.query(
      "UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2",
      [hash, u.id]
    );

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// -----------------------------------------------------
//  PŮVODNÍ FUNKČNÍ KÓD — BEZ ZMĚN
// -----------------------------------------------------

// FOODS
app.get("/api/foods", async (req, res) => {
  try {
    const r = await pool.query("SELECT * FROM foods ORDER BY id ASC");
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// ADMIN MENU
app.get("/api/admin/menu", async (req, res) => {
  try {
    const date = req.query.date;
    const r = await pool.query(
      `SELECT menu.id, foods.name, foods.price, menu.maxCount
       FROM menu JOIN foods ON foods.id = menu.foodId
       WHERE menu.date = $1 ORDER BY menu.id ASC`,
      [date]
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

app.post("/api/admin/menu/add", async (req, res) => {
  try {
    const { date, foodId, maxCount } = req.body;

    await pool.query(
      "INSERT INTO menu (date, foodId, maxCount, ordered) VALUES ($1, $2, $3, 0)",
      [date, foodId, maxCount]
    );

    const r = await pool.query(
      `SELECT menu.id, foods.name, foods.price, menu.maxCount
       FROM menu JOIN foods ON foods.id = menu.foodId
       WHERE menu.date = $1 ORDER BY menu.id ASC`,
      [date]
    );

    res.json({ success: true, items: r.rows });
  } catch {
    res.json({ success: false });
  }
});

app.post("/api/admin/menu/update", async (req, res) => {
  try {
    await pool.query("UPDATE menu SET maxCount = $1 WHERE id = $2", [
      req.body.maxCount,
      req.body.id,
    ]);
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

app.post("/api/admin/menu/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM menu WHERE id = $1", [req.body.id]);
    res.json({ success: true });
  } catch {
    res.json({ success: false });
  }
});

// MENU PRO UŽIVATELE
app.get("/api/menu", async (req, res) => {
  try {
    const date = req.query.date;
    const r = await pool.query(
      `SELECT foods.name, foods.price, menu.maxCount, menu.ordered
       FROM menu JOIN foods ON foods.id = menu.foodId
       WHERE menu.date = $1 ORDER BY menu.id ASC`,
      [date]
    );

    res.json(
      r.rows.map((x) => ({
        name: x.name,
        price: x.price,
        remaining: x.maxcount - x.ordered,
        maxCount: x.maxcount,
      }))
    );
  } catch {
    res.json([]);
  }
});

// OBJEDNÁVKA (původní plně funkční logika)
app.post("/api/order", async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, date, items } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.json({ success: false, error: "Prázdná objednávka" });

    const total = items.reduce((s, i) => s + i.price, 0);

    const grouped = {};
    items.forEach((i) => (grouped[i.name] = (grouped[i.name] || 0) + 1));

    await client.query("BEGIN");

    const menuRes = await client.query(
      `SELECT foods.name, menu.maxCount, menu.ordered
       FROM menu JOIN foods ON foods.id = menu.foodId
       WHERE menu.date = $1`,
      [date]
    );

    for (const name in grouped) {
      const row = menuRes.rows.find((r) => r.name === name);
      if (!row || row.ordered + grouped[name] > row.maxcount) {
        await client.query("ROLLBACK");
        return res.json({ success: false, error: "Nedostatek skladových kusů" });
      }
    }

    const uRes = await client.query("SELECT credit FROM users WHERE id = $1 FOR UPDATE", [userId]);
    const credit = uRes.rows[0].credit;

    if (credit < total) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Nedostatečný kredit" });
    }

    await client.query("UPDATE users SET credit = credit - $1 WHERE id = $2", [total, userId]);

    for (const name in grouped) {
      await client.query(
        `UPDATE menu SET ordered = ordered + $1
         WHERE date = $2 AND foodId = (SELECT id FROM foods WHERE name = $3)`,
        [grouped[name], date, name]
      );
    }

    const itemNames = items.map((i) => i.name).join(", ");

    await client.query(
      `INSERT INTO orders (userId, date, itemNames, price, status)
       VALUES ($1, $2, $3, $4, 'ok')`,
      [userId, date, itemNames, total]
    );

    await client.query("COMMIT");

    res.json({ success: true, credit: credit - total });
  } catch (err) {
    console.log(err);
    try {
      await client.query("ROLLBACK");
    } catch {}
    res.json({ success: false });
  } finally {
    client.release();
  }
});

// HISTORIE
app.get("/api/orders/history", async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT * FROM orders WHERE userId = $1 AND status='ok' ORDER BY date DESC, id DESC`,
      [req.query.userId]
    );
    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// ZRUŠENÍ
app.post("/api/orders/cancel", async (req, res) => {
  const client = await pool.connect();
  try {
    const { orderId } = req.body;

    await client.query("BEGIN");

    const o = await client.query("SELECT * FROM orders WHERE id = $1", [orderId]);
    if (o.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: false });
    }

    const order = o.rows[0];
    const today = new Date().toISOString().slice(0, 10);

    if (order.date <= today) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Zrušit lze den dopředu" });
    }

    const items = order.itemnames.split(", ").filter(Boolean);

    for (const n of items) {
      await client.query(
        `UPDATE menu SET ordered = ordered - 1
         WHERE date = $1 AND foodId = (SELECT id FROM foods WHERE name = $2)`,
        [order.date, n]
      );
    }

    await client.query("UPDATE users SET credit = credit + $1 WHERE id = $2", [
      order.price,
      order.userid,
    ]);

    await client.query("UPDATE orders SET status='cancelled' WHERE id = $1", [
      orderId,
    ]);

    const r = await client.query("SELECT credit FROM users WHERE id = $1", [
      order.userid,
    ]);

    await client.query("COMMIT");

    res.json({ success: true, credit: r.rows[0].credit });
  } catch (err) {
    console.log(err);
    await client.query("ROLLBACK");
    res.json({ success: false });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  ★ NOVÝ TOPUP S ADMIN POTVRZENÍM ★
// -----------------------------------------------------

// Uživatel vytvoří požadavek
app.post("/api/topup", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const r = await pool.query(
      "INSERT INTO topups (userId, amount, done) VALUES ($1, $2, 0) RETURNING id",
      [userId, amount]
    );

    const id = r.rows[0].id;

    res.json({
      success: true,
      paymentId: id,
      qr: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${id}`,
    });
  } catch (err) {
    res.json({ success: false });
  }
});

// Stav — už jen kontrola
app.get("/api/topup/status", async (req, res) => {
  try {
    const id = req.query.id;
    const r = await pool.query("SELECT * FROM topups WHERE id = $1", [id]);

    if (r.rowCount === 0) return res.json({ done: false, credit: 0 });

    const t = r.rows[0];
    const u = await pool.query("SELECT credit FROM users WHERE id = $1", [
      t.userid,
    ]);

    res.json({ done: t.done === 1, credit: u.rows[0].credit });
  } catch (err) {
    res.json({ done: false, credit: 0 });
  }
});

// Admin: seznam čekajících
app.get("/api/admin/topups", async (req, res) => {
  const r = await pool.query(
    `SELECT topups.id, topups.amount, users.identifier
     FROM topups JOIN users ON users.id = topups.userId
     WHERE done = 0 ORDER BY id ASC`
  );
  res.json(r.rows);
});

// Admin: schválení dobíjení
app.post("/api/admin/topups/approve", async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.body;

    await client.query("BEGIN");

    const t = await client.query("SELECT * FROM topups WHERE id = $1 FOR UPDATE", [id]);
    if (t.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: false });
    }

    const topup = t.rows[0];
    if (topup.done === 1) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Už schváleno" });
    }

    await client.query("UPDATE users SET credit = credit + $1 WHERE id = $2", [
      topup.amount,
      topup.userid,
    ]);

    await client.query("UPDATE topups SET done = 1 WHERE id = $1", [id]);

    const u = await client.query("SELECT credit FROM users WHERE id = $1", [
      topup.userid,
    ]);

    await client.query("COMMIT");

    res.json({ success: true, credit: u.rows[0].credit });
  } catch (err) {
    console.log(err);
    await client.query("ROLLBACK");
    res.json({ success: false });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  STATISTIKY – TOP FOODS + NOVĚ TOP USERS
// -----------------------------------------------------
app.get("/api/admin/stats/month", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const limit = since.toISOString().slice(0, 10);

    const orders = await pool.query(
      "SELECT itemNames, price FROM orders WHERE date >= $1 AND status='ok'",
      [limit]
    );

    let total = 0;
    const foods = {};

    orders.rows.forEach((o) => {
      total += o.price;
      o.itemnames?.split(", ").forEach((n) => {
        if (!n) return;
        foods[n] = (foods[n] || 0) + 1;
      });
    });

    const topFoods = Object.entries(foods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    res.json({ total, topFoods });
  } catch {
    res.json({ total: 0, topFoods: [] });
  }
});

// TOP USERS
app.get("/api/admin/stats/users", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const limit = since.toISOString().slice(0, 10);

    const r = await pool.query(`
      SELECT users.identifier, SUM(orders.price) AS spent
      FROM orders
      JOIN users ON users.id = orders.userid
      WHERE orders.date >= $1 AND orders.status='ok'
      GROUP BY users.identifier
      ORDER BY spent DESC
      LIMIT 10
    `, [limit]);

    res.json(r.rows);
  } catch {
    res.json([]);
  }
});

// -----------------------------------------------------
//  START SERVERU
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;
initDb().then(() => {
  app.listen(PORT, () => console.log("Server běží na portu", PORT));
});