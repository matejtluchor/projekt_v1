// backend/server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// -----------------------------------------------------
//  LOGOVÁNÍ REQUESTŮ
// -----------------------------------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------------------------------
//  POSTGRESQL
// -----------------------------------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// -----------------------------------------------------
//  JWT MIDDLEWARE
// -----------------------------------------------------
function auth(req, res, next) {
  const h = req.headers.authorization;
  if (!h) {
    return res.status(401).json({ success: false, error: "Chybí token" });
  }

  const token = h.split(" ")[1];
  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ success: false, error: "Neplatný token" });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== "admin" && req.user.role !== "manager") {
    return res.status(403).json({ success: false, error: "Zakázáno" });
  }
  next();
}

// -----------------------------------------------------
//  INIT DB
// -----------------------------------------------------
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      identifier TEXT UNIQUE,
      credit INTEGER DEFAULT 0,
      password_hash TEXT,
      role TEXT DEFAULT 'user'
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

  const admins = [
    { identifier: "admin", password: "1973", role: "admin" },
    { identifier: "manager", password: "123", role: "manager" },
  ];

  for (const u of admins) {
    const hash = await bcrypt.hash(u.password, 10);
    const ex = await pool.query(
      "SELECT id FROM users WHERE identifier = $1",
      [u.identifier]
    );

    if (ex.rowCount > 0) {
      await pool.query(
        "UPDATE users SET password_hash=$1, role=$2 WHERE id=$3",
        [hash, u.role, ex.rows[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO users (identifier,password_hash,role,credit) VALUES ($1,$2,$3,0)",
        [u.identifier, hash, u.role]
      );
    }
  }

  console.log("✅ DB připravena");
}

// -----------------------------------------------------
//  REGISTER
// -----------------------------------------------------
app.post("/api/register", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.json({ success: false, error: "Vyplň jméno i heslo" });
    }

    if (["admin", "manager"].includes(identifier.toLowerCase())) {
      return res.json({ success: false, error: "Rezervované jméno" });
    }

    const hash = await bcrypt.hash(password, 10);

    const r = await pool.query(
      `
      INSERT INTO users (identifier,password_hash,role,credit)
      VALUES ($1,$2,'user',0)
      RETURNING id,credit,role
    `,
      [identifier, hash]
    );

    const u = r.rows[0];

    const token = jwt.sign(
      { id: u.id, role: u.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      success: true,
      token,
      credit: u.credit,
      role: u.role,
      identifier,
    });
  } catch (err) {
    console.error("REGISTER error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    const r = await pool.query(
      "SELECT * FROM users WHERE identifier=$1",
      [identifier]
    );

    if (!r.rowCount) {
      return res.json({ success: false, error: "Uživatel neexistuje" });
    }

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);

    if (!ok) {
      return res.json({ success: false, error: "Špatné heslo" });
    }

    const token = jwt.sign(
      { id: u.id, role: u.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      success: true,
      token,
      credit: u.credit,
      role: u.role,
      identifier,
    });
  } catch (err) {
    console.error("LOGIN error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------------------------
//  FOODS (ADMIN)
// -----------------------------------------------------
app.get("/api/foods", auth, adminOnly, async (req, res) => {
  const r = await pool.query("SELECT * FROM foods ORDER BY id ASC");
  res.json(r.rows || []);
});

// -----------------------------------------------------
//  ADMIN MENU
// -----------------------------------------------------
app.get("/api/admin/menu", auth, adminOnly, async (req, res) => {
  const date = req.query.date;

  const r = await pool.query(
    `
    SELECT menu.id, foods.name, foods.price, menu.maxCount
    FROM menu
    JOIN foods ON foods.id = menu.foodId
    WHERE menu.date = $1
  `,
    [date]
  );

  res.json(r.rows || []);
});

app.post("/api/admin/menu/add", auth, adminOnly, async (req, res) => {
  const { date, foodId, maxCount } = req.body;

  await pool.query(
    "INSERT INTO menu (date,foodId,maxCount,ordered) VALUES ($1,$2,$3,0)",
    [date, foodId, maxCount]
  );

  const r = await pool.query(
    `
    SELECT menu.id, foods.name, foods.price, menu.maxCount
    FROM menu JOIN foods ON foods.id = menu.foodId
    WHERE menu.date = $1
  `,
    [date]
  );

  res.json({ success: true, items: r.rows });
});

app.post("/api/admin/menu/update", auth, adminOnly, async (req, res) => {
  await pool.query("UPDATE menu SET maxCount=$1 WHERE id=$2", [
    req.body.maxCount,
    req.body.id,
  ]);
  res.json({ success: true });
});

app.post("/api/admin/menu/delete", auth, adminOnly, async (req, res) => {
  await pool.query("DELETE FROM menu WHERE id=$1", [req.body.id]);
  res.json({ success: true });
});

// -----------------------------------------------------
//  MENU (USER)
// -----------------------------------------------------
app.get("/api/menu", auth, async (req, res) => {
  const date = req.query.date;

  const r = await pool.query(
    `
    SELECT foods.name, foods.price, menu.maxCount, menu.ordered
    FROM menu JOIN foods ON foods.id = menu.foodId
    WHERE menu.date = $1
  `,
    [date]
  );

  res.json(
    r.rows.map((i) => ({
      name: i.name,
      price: i.price,
      maxCount: i.maxcount,
      remaining: i.maxcount - i.ordered,
    }))
  );
});

// -----------------------------------------------------
//  OBJEDNÁVKA + SKLAD + KREDIT
// -----------------------------------------------------
app.post("/api/order", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = req.user.id;
    const { date, items } = req.body;

    if (!items || !items.length) {
      return res.json({ success: false, error: "Prázdná objednávka" });
    }

    const total = items.reduce((s, i) => s + i.price, 0);

    const grouped = {};
    items.forEach((i) => {
      grouped[i.name] = (grouped[i.name] || 0) + 1;
    });

    await client.query("BEGIN");

    const menuRes = await client.query(
      `
      SELECT foods.name, menu.maxCount, menu.ordered
      FROM menu JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
    `,
      [date]
    );

    for (const name in grouped) {
      const row = menuRes.rows.find((r) => r.name === name);
      if (!row || row.ordered + grouped[name] > row.maxcount) {
        await client.query("ROLLBACK");
        return res.json({
          success: false,
          error: "Nedostatek kusů",
        });
      }
    }

    const u = await client.query(
      "SELECT credit FROM users WHERE id=$1 FOR UPDATE",
      [userId]
    );

    if (u.rows[0].credit < total) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Nedostatečný kredit" });
    }

    await client.query(
      "UPDATE users SET credit = credit - $1 WHERE id=$2",
      [total, userId]
    );

    for (const name in grouped) {
      await client.query(
        `
        UPDATE menu
        SET ordered = ordered + $1
        WHERE date = $2
        AND foodId = (SELECT id FROM foods WHERE name=$3)
      `,
        [grouped[name], date, name]
      );
    }

    const names = items.map((i) => i.name).join(", ");

    await client.query(
      `
      INSERT INTO orders (userId,date,itemNames,price,status)
      VALUES ($1,$2,$3,$4,'ok')
    `,
      [userId, date, names, total]
    );

    await client.query("COMMIT");

    res.json({ success: true, credit: u.rows[0].credit - total });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false, error: "Server error" });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  HISTORIE OBJEDNÁVEK
// -----------------------------------------------------
app.get("/api/orders/history", auth, async (req, res) => {
  const r = await pool.query(
    `
    SELECT id, date, itemNames, price
    FROM orders
    WHERE userId=$1 AND status='ok'
    ORDER BY date DESC, id DESC
  `,
    [req.user.id]
  );

  res.json(r.rows || []);
});

// -----------------------------------------------------
//  ZRUŠENÍ OBJEDNÁVKY
// -----------------------------------------------------
app.post("/api/orders/cancel", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    const { orderId } = req.body;

    await client.query("BEGIN");

    const r = await client.query(
      "SELECT * FROM orders WHERE id=$1",
      [orderId]
    );

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.json({ success: false });
    }

    const order = r.rows[0];
    const today = new Date().toISOString().slice(0, 10);

    if (order.date <= today) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávku lze zrušit jen den dopředu",
      });
    }

    const items = (order.itemnames || "").split(", ").filter(Boolean);

    for (const name of items) {
      await client.query(
        `
        UPDATE menu
        SET ordered = ordered - 1
        WHERE date=$1
        AND foodId=(SELECT id FROM foods WHERE name=$2)
      `,
        [order.date, name]
      );
    }

    await client.query(
      "UPDATE users SET credit = credit + $1 WHERE id=$2",
      [order.price, order.userid]
    );

    await client.query(
      "UPDATE orders SET status='cancelled' WHERE id=$1",
      [orderId]
    );

    const u = await client.query(
      "SELECT credit FROM users WHERE id=$1",
      [order.userid]
    );

    await client.query("COMMIT");
    res.json({ success: true, credit: u.rows[0].credit });
  } catch (err) {
    await client.query("ROLLBACK");
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  TOPUP + QR
// -----------------------------------------------------
app.post("/api/topup", auth, async (req, res) => {
  const { amount } = req.body;

  const r = await pool.query(
    "INSERT INTO topups (userId,amount,done) VALUES ($1,$2,0) RETURNING id",
    [req.user.id, amount]
  );

  res.json({
    success: true,
    paymentId: r.rows[0].id,
    qr: `https://api.qrserver.com/v1/create-qr-code/?data=${r.rows[0].id}`,
  });
});

app.get("/api/topup/status", auth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const t = await client.query(
      "SELECT * FROM topups WHERE id=$1",
      [req.query.id]
    );

    if (!t.rowCount) {
      await client.query("ROLLBACK");
      return res.json({ done: false, credit: 0 });
    }

    const top = t.rows[0];

    if (!top.done) {
      await client.query("UPDATE topups SET done=1 WHERE id=$1", [top.id]);
      await client.query(
        "UPDATE users SET credit = credit + $1 WHERE id=$2",
        [top.amount, top.userid]
      );
    }

    const u = await client.query(
      "SELECT credit FROM users WHERE id=$1",
      [top.userid]
    );

    await client.query("COMMIT");
    res.json({ done: true, credit: u.rows[0].credit });
  } catch {
    await client.query("ROLLBACK");
    res.json({ done: false, credit: 0 });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  ADMIN STATISTIKY
// -----------------------------------------------------
app.get("/api/admin/stats/month", auth, adminOnly, async (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const dateStr = since.toISOString().slice(0, 10);

  const r = await pool.query(
    "SELECT itemNames, price FROM orders WHERE date >= $1 AND status='ok'",
    [dateStr]
  );

  let total = 0;
  const foods = {};

  r.rows.forEach((o) => {
    total += o.price;
    (o.itemnames || "").split(", ").forEach((n) => {
      foods[n] = (foods[n] || 0) + 1;
    });
  });

  const topFoods = Object.entries(foods)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  res.json({ total, topFoods });
});

app.get("/api/admin/stats/day", auth, adminOnly, async (req, res) => {
  const r = await pool.query(
    "SELECT itemNames FROM orders WHERE date=$1 AND status='ok'",
    [req.query.date]
  );

  const sum = {};
  r.rows.forEach((o) => {
    (o.itemnames || "").split(", ").forEach((n) => {
      sum[n] = (sum[n] || 0) + 1;
    });
  });

  res.json(sum);
});

// -----------------------------------------------------
//  START
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;

initDb().then(() => {
  app.listen(PORT, () => {
    console.log("✅ Backend běží na portu " + PORT);
  });
});
