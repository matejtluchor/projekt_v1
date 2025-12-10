// backend/server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// -----------------------------------------------------
//  POSTGRESQL PŘIPOJENÍ
// -----------------------------------------------------

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL není nastavená. Nastav ji na Renderu (Internal Database URL z Postgres DB)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// -----------------------------------------------------
//  VYTVOŘENÍ TABULEK + ÚPRAVA USERS + ADMIN ÚČTY
// -----------------------------------------------------
async function initDb() {
  // základní tabulky
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      identifier TEXT UNIQUE,
      credit INTEGER DEFAULT 0
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

  // přidání sloupců pro heslo + roli (pokud ještě nejsou)
  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS password_hash TEXT;
  `);

  await pool.query(`
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
  `);

  // starým userům bez role nastavíme user
  await pool.query(`UPDATE users SET role = 'user' WHERE role IS NULL;`);

  // vytvoření / aktualizace admin a manager účtů
  const adminsToSeed = [
    { identifier: "admin", password: "1973", role: "admin" },
    { identifier: "manager", password: "123", role: "manager" },
  ];

  for (const u of adminsToSeed) {
    const hash = await bcrypt.hash(u.password, 10);

    const existing = await pool.query(
      "SELECT id FROM users WHERE identifier = $1",
      [u.identifier]
    );

    if (existing.rowCount > 0) {
      await pool.query(
        "UPDATE users SET role = $1, password_hash = $2 WHERE id = $3",
        [u.role, hash, existing.rows[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO users (identifier, password_hash, role, credit) VALUES ($1, $2, $3, 0)",
        [u.identifier, hash, u.role]
      );
    }
  }

  console.log("✅ PostgreSQL tabulky + uživatelé (admin/manager) připravené");
}

// -----------------------------------------------------
//  REGISTRACE
// -----------------------------------------------------
app.post("/api/register", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res.json({
        success: false,
        error: "Vyplň uživatelské jméno i heslo.",
      });
    }

    // zakážeme použít názvy admin/manager
    if (["admin", "manager"].includes(identifier.toLowerCase())) {
      return res.json({
        success: false,
        error: "Toto jméno je rezervované pro administrátory.",
      });
    }

    const exists = await pool.query(
      "SELECT id FROM users WHERE identifier = $1",
      [identifier]
    );
    if (exists.rowCount > 0) {
      return res.json({
        success: false,
        error: "Tento uživatel už existuje.",
      });
    }

    const hash = await bcrypt.hash(password, 10);

    const insert = await pool.query(
      `
      INSERT INTO users (identifier, password_hash, role, credit)
      VALUES ($1, $2, 'user', 0)
      RETURNING id, credit, role, identifier
    `,
      [identifier, hash]
    );

    const u = insert.rows[0];

    // AUTO LOGIN po registraci
    return res.json({
      success: true,
      userId: u.id,
      credit: u.credit,
      role: u.role,
      identifier: u.identifier,
    });
  } catch (err) {
    console.error("POST /api/register error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body || {};

    if (!identifier || !password) {
      return res.json({
        success: false,
        error: "Vyplň uživatelské jméno i heslo.",
      });
    }

    const result = await pool.query(
      "SELECT id, credit, role, password_hash, identifier FROM users WHERE identifier = $1",
      [identifier]
    );

    if (result.rowCount === 0) {
      return res.json({
        success: false,
        error: "Uživatel neexistuje.",
      });
    }

    const user = result.rows[0];

    if (!user.password_hash) {
      return res.json({
        success: false,
        error: "Tento účet nemá nastavené heslo.",
      });
    }

    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      return res.json({
        success: false,
        error: "Špatné jméno nebo heslo.",
      });
    }

    res.json({
      success: true,
      userId: user.id,
      credit: user.credit,
      role: user.role || "user",
      identifier: user.identifier,
    });
  } catch (err) {
    console.error("LOGIN error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------------------------
//  FOODS
// -----------------------------------------------------
app.get("/api/foods", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM foods ORDER BY id ASC");
    res.json(result.rows || []);
  } catch (err) {
    console.error("GET /api/foods error:", err);
    res.status(500).json([]);
  }
});

// -----------------------------------------------------
//  ADMIN MENU
// -----------------------------------------------------
app.get("/api/admin/menu", async (req, res) => {
  try {
    const date = req.query.date;
    const result = await pool.query(
      `
      SELECT menu.id, foods.name, foods.price, menu.maxCount
      FROM menu 
      JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
      ORDER BY menu.id ASC
    `,
      [date]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("GET /api/admin/menu error:", err);
    res.status(500).json([]);
  }
});

app.post("/api/admin/menu/add", async (req, res) => {
  try {
    const { date, foodId, maxCount } = req.body;

    await pool.query(
      "INSERT INTO menu (date, foodId, maxCount, ordered) VALUES ($1, $2, $3, 0)",
      [date, foodId, maxCount]
    );

    const items = await pool.query(
      `
      SELECT menu.id, foods.name, foods.price, menu.maxCount
      FROM menu 
      JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
      ORDER BY menu.id ASC
    `,
      [date]
    );

    res.json({ success: true, items: items.rows || [] });
  } catch (err) {
    console.error("POST /api/admin/menu/add error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/menu/update", async (req, res) => {
  try {
    const { id, maxCount } = req.body;
    await pool.query("UPDATE menu SET maxCount = $1 WHERE id = $2", [
      maxCount,
      id,
    ]);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/admin/menu/update error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.post("/api/admin/menu/delete", async (req, res) => {
  try {
    await pool.query("DELETE FROM menu WHERE id = $1", [req.body.id]);
    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/admin/menu/delete error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

// -----------------------------------------------------
//  MENU PRO UŽIVATELE
// -----------------------------------------------------
app.get("/api/menu", async (req, res) => {
  try {
    const date = req.query.date;

    const result = await pool.query(
      `
      SELECT foods.name, foods.price, menu.maxCount, menu.ordered
      FROM menu 
      JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
      ORDER BY menu.id ASC
    `,
      [date]
    );

    const rows = result.rows || [];

    res.json(
      rows.map((r) => ({
        name: r.name,
        price: r.price,
        maxCount: r.maxcount,
        remaining: r.maxcount - r.ordered,
      }))
    );
  } catch (err) {
    console.error("GET /api/menu error:", err);
    res.status(500).json([]);
  }
});

// -----------------------------------------------------
//  OBJEDNÁVKA + KONTROLA SKLADU
// -----------------------------------------------------
app.post("/api/order", async (req, res) => {
  const client = await pool.connect();
  try {
    const { userId, date, items } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.json({ success: false, error: "Prázdná objednávka" });
    }

    const total = items.reduce((s, i) => s + i.price, 0);

    // spočítat kolik kusů od každého jídla
    const grouped = {};
    items.forEach((i) => {
      grouped[i.name] = (grouped[i.name] || 0) + 1;
    });

    await client.query("BEGIN");

    // sklad
    const menuRes = await client.query(
      `
      SELECT foods.name, menu.maxCount, menu.ordered
      FROM menu 
      JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
    `,
      [date]
    );
    const menuRows = menuRes.rows || [];

    for (const name in grouped) {
      const row = menuRows.find((r) => r.name === name);
      if (!row || row.ordered + grouped[name] > row.maxcount) {
        await client.query("ROLLBACK");
        return res.json({
          success: false,
          error: "Není dostatek kusů na skladě",
        });
      }
    }

    // kredit uživatele (lockneme řádek)
    const userRes = await client.query(
      "SELECT credit FROM users WHERE id = $1 FOR UPDATE",
      [userId]
    );
    if (userRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Uživatel neexistuje" });
    }
    const currentCredit = userRes.rows[0].credit;

    if (currentCredit < total) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Nedostatečný kredit" });
    }

    // odečíst kredit
    await client.query(
      "UPDATE users SET credit = credit - $1 WHERE id = $2",
      [total, userId]
    );

    // aktualizovat objednané kusy v menu
    for (const name in grouped) {
      const count = grouped[name];

      await client.query(
        `
        UPDATE menu 
        SET ordered = ordered + $1
        WHERE date = $2
          AND foodId = (SELECT id FROM foods WHERE name = $3)
      `,
        [count, date, name]
      );
    }

    const itemsStr = items.map((i) => i.name).join(", ");

    await client.query(
      `
      INSERT INTO orders (userId, date, itemNames, price, status)
      VALUES ($1, $2, $3, $4, $5)
    `,
      [userId, date, itemsStr, total, "ok"]
    );

    await client.query("COMMIT");

    res.json({ success: true, credit: currentCredit - total });
  } catch (err) {
    console.error("POST /api/order error:", err);
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ success: false, error: "Server error" });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  HISTORIE OBJEDNÁVEK
// -----------------------------------------------------
app.get("/api/orders/history", async (req, res) => {
  try {
    const userId = req.query.userId;
    const result = await pool.query(
      `
      SELECT id, date, itemNames AS "itemNames", price 
      FROM orders
      WHERE userId = $1 AND status = 'ok'
      ORDER BY date DESC, id DESC
    `,
      [userId]
    );

    res.json(result.rows || []);
  } catch (err) {
    console.error("GET /api/orders/history error:", err);
    res.status(500).json([]);
  }
});

// -----------------------------------------------------
//  ZRUŠENÍ OBJEDNÁVKY
// -----------------------------------------------------
app.post("/api/orders/cancel", async (req, res) => {
  const client = await pool.connect();
  try {
    const { orderId } = req.body;

    await client.query("BEGIN");

    const orderRes = await client.query(
      "SELECT * FROM orders WHERE id = $1",
      [orderId]
    );
    if (orderRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ success: false });
    }

    const order = orderRes.rows[0];

    const today = new Date().toISOString().slice(0, 10);
    if (order.date <= today) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávku lze zrušit jen den dopředu!",
      });
    }

    const items = (order.itemnames || "").split(", ").filter(Boolean);

    for (const name of items) {
      await client.query(
        `
        UPDATE menu 
        SET ordered = ordered - 1
        WHERE date = $1 
          AND foodId = (SELECT id FROM foods WHERE name = $2)
      `,
        [order.date, name]
      );
    }

    await client.query(
      "UPDATE users SET credit = credit + $1 WHERE id = $2",
      [order.price, order.userid]
    );

    await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [
      orderId,
    ]);

    const userRes = await client.query(
      "SELECT credit FROM users WHERE id = $1",
      [order.userid]
    );
    const credit = userRes.rowCount ? userRes.rows[0].credit : undefined;

    await client.query("COMMIT");

    res.json({ success: true, credit });
  } catch (err) {
    console.error("POST /api/orders/cancel error:", err);
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ success: false, error: "Server error" });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  QR DOBÍJENÍ
// -----------------------------------------------------
app.post("/api/topup", async (req, res) => {
  try {
    const { userId, amount } = req.body;

    const result = await pool.query(
      `
      INSERT INTO topups (userId, amount, done)
      VALUES ($1, $2, 0)
      RETURNING id
    `,
      [userId, amount]
    );

    const paymentId = result.rows[0].id;

    res.json({
      success: true,
      paymentId,
      qr: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${paymentId}`,
    });
  } catch (err) {
    console.error("POST /api/topup error:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});

app.get("/api/topup/status", async (req, res) => {
  const client = await pool.connect();
  try {
    const id = req.query.id;

    await client.query("BEGIN");

    const topRes = await client.query("SELECT * FROM topups WHERE id = $1", [
      id,
    ]);
    if (topRes.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.json({ done: false, credit: 0 });
    }

    const topup = topRes.rows[0];

    if (!topup.done) {
      await client.query("UPDATE topups SET done = 1 WHERE id = $1", [id]);
      await client.query(
        "UPDATE users SET credit = credit + $1 WHERE id = $2",
        [topup.amount, topup.userid]
      );
    }

    const userRes = await client.query(
      "SELECT credit FROM users WHERE id = $1",
      [topup.userid]
    );
    const credit = userRes.rowCount ? userRes.rows[0].credit : 0;

    await client.query("COMMIT");

    res.json({ done: true, credit });
  } catch (err) {
    console.error("GET /api/topup/status error:", err);
    try {
      await client.query("ROLLBACK");
    } catch (_) {}
    res.status(500).json({ done: false, credit: 0 });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
//  STATISTIKY – POSLEDNÍCH 30 DNÍ
// -----------------------------------------------------
app.get("/api/admin/stats/month", async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30);
    const dateStr = since.toISOString().slice(0, 10);

    const result = await pool.query(
      `
      SELECT itemNames AS "itemNames", price 
      FROM orders 
      WHERE date >= $1 AND status = 'ok'
    `,
      [dateStr]
    );

    let total = 0;
    const foods = {};

    result.rows.forEach((o) => {
      total += o.price;
      (o.itemNames || "")
        .split(", ")
        .filter(Boolean)
        .forEach((n) => {
          foods[n] = (foods[n] || 0) + 1;
        });
    });

    const topFoods = Object.entries(foods)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    res.json({ total, topFoods });
  } catch (err) {
    console.error("GET /api/admin/stats/month error:", err);
    res.status(500).json({ total: 0, topFoods: [] });
  }
});

// -----------------------------------------------------
//  STATISTIKY – SOUČET OBJEDNÁVEK NA DEN
// -----------------------------------------------------
app.get("/api/admin/stats/day", async (req, res) => {
  try {
    const date = req.query.date;

    const result = await pool.query(
      `
      SELECT itemNames AS "itemNames"
      FROM orders 
      WHERE date = $1 AND status = 'ok'
    `,
      [date]
    );

    const sum = {};
    result.rows.forEach((o) => {
      (o.itemNames || "")
        .split(", ")
        .filter(Boolean)
        .forEach((n) => {
          sum[n] = (sum[n] || 0) + 1;
        });
    });

    res.json(sum);
  } catch (err) {
    console.error("GET /api/admin/stats/day error:", err);
    res.status(500).json({});
  }
});

// -----------------------------------------------------
//  START SERVERU – nejdřív init DB, pak posloucháme
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => {
      console.log("✅ Backend běží na portu " + PORT);
    });
  })
  .catch((err) => {
    console.error("❌ Chyba při inicializaci databáze:", err);
    process.exit(1);
  });
