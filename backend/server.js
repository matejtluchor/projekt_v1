// backend/server.js
const express = require("express");
const path = require("path");
const { Pool } = require("pg");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

// -----------------------------------------------------
//  POSTGRESQL PŘIPOJENÍ
// -----------------------------------------------------
// Na Renderu nastavíš proměnnou DATABASE_URL
// = "Internal Database URL" z tvé Postgres DB (jidelnapp-db).

if (!process.env.DATABASE_URL) {
  console.warn(
    "⚠️  DATABASE_URL není nastavená. Nastav ji na Renderu (Internal Database URL z Postgres DB)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render interní URL už má v sobě nastavené sslmode, takže
  // tady nic dalšího řešit nemusíme.
});

// -----------------------------------------------------
//  VYTVOŘENÍ TABULEK (při startu backendu)
// -----------------------------------------------------
async function initDb() {
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

  console.log("✅ PostgreSQL tabulky jsou připravené");
}

// -----------------------------------------------------
//  ADMIN / MANAGER
// -----------------------------------------------------
const ADMINS = {
  admin: "1973",
  manager: "123",
};

// -----------------------------------------------------
//  LOGIN
// -----------------------------------------------------
app.post("/api/login", async (req, res) => {
  try {
    const { identifier, password } = req.body;

    // kontrola admin hesla
    if (ADMINS[identifier] && ADMINS[identifier] !== password) {
      return res.json({ success: false, error: "Špatné heslo" });
    }

    const result = await pool.query(
      "SELECT * FROM users WHERE identifier = $1",
      [identifier]
    );

    let user;

    if (result.rowCount === 0) {
      const insert = await pool.query(
        "INSERT INTO users (identifier, credit) VALUES ($1, 0) RETURNING id, credit",
        [identifier]
      );
      user = insert.rows[0];
    } else {
      user = result.rows[0];
    }

    res.json({
      success: true,
      userId: user.id,
      credit: user.credit,
      role: ADMINS[identifier] ? "admin" : "user",
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
      await pool.query("ROLLBACK");
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
      SELECT id, date, itemNames, price 
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

    const items = order.itemnames.split(", ");

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
      SELECT itemNames, price 
      FROM orders 
      WHERE date >= $1 AND status = 'ok'
    `,
      [dateStr]
    );

    let total = 0;
    const foods = {};

    result.rows.forEach((o) => {
      total += o.price;
      o.itemnames.split(", ").forEach((n) => {
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
      SELECT itemNames 
      FROM orders 
      WHERE date = $1 AND status = 'ok'
    `,
      [date]
    );

    const sum = {};
    result.rows.forEach((o) => {
      o.itemnames.split(", ").forEach((n) => {
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
//  SEED: 10 POLÉVEK + 20 HLAVNÍCH JÍDEL
// -----------------------------------------------------
app.get("/api/admin/seed-foods", async (req, res) => {
  const foods = [
    // ===== POLÉVKY (10x) =====
    { name: "Polévka – Gulášová", price: 39 },
    { name: "Polévka – Česnečka", price: 35 },
    { name: "Polévka – Kuřecí vývar", price: 34 },
    { name: "Polévka – Dršťková", price: 42 },
    { name: "Polévka – Rajská", price: 33 },
    { name: "Polévka – Zelná", price: 36 },
    { name: "Polévka – Bramboračka", price: 37 },
    { name: "Polévka – Hovězí vývar", price: 38 },
    { name: "Polévka – Fazolová", price: 35 },
    { name: "Polévka – Kulajda", price: 40 },

    // ===== HLAVNÍ JÍDLA (20x) =====
    { name: "Hlavní – Smažený sýr s hranolky", price: 129 },
    { name: "Hlavní – Kuřecí řízek s bramborem", price: 135 },
    { name: "Hlavní – Vepřový řízek s kaší", price: 139 },
    { name: "Hlavní – Svíčková na smetaně", price: 155 },
    { name: "Hlavní – Hovězí guláš s knedlíkem", price: 145 },
    { name: "Hlavní – Kuřecí steak s rýží", price: 142 },
    { name: "Hlavní – Těstoviny s kuřecím masem", price: 129 },
    { name: "Hlavní – Smažené kuřecí stripsy", price: 134 },
    { name: "Hlavní – Segedínský guláš", price: 139 },
    { name: "Hlavní – Pečené kuře s nádivkou", price: 148 },

    { name: "Hlavní – Vepřová pečeně se zelím", price: 149 },
    { name: "Hlavní – Hovězí na houbách", price: 152 },
    { name: "Hlavní – Kuřecí na paprice", price: 138 },
    { name: "Hlavní – Smažený květák", price: 119 },
    { name: "Hlavní – Špagety Carbonara", price: 135 },
    { name: "Hlavní – Lasagne", price: 145 },
    { name: "Hlavní – Rizoto s kuřecím masem", price: 132 },
    { name: "Hlavní – Vepřový plátek na hořčici", price: 141 },
    { name: "Hlavní – Kuřecí burger s hranolky", price: 149 },
    { name: "Hlavní – Hranolky se sýrovou omáčkou", price: 109 },
  ];

  try {
    for (const f of foods) {
      await pool.query(
        "INSERT INTO foods (name, price) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [f.name, f.price]
      );
    }

    res.json({
      success: true,
      message: "✅ 10 polévek a 20 hlavních jídel bylo úspěšně vloženo",
    });
  } catch (err) {
    console.error("SEED ERROR:", err);
    res.status(500).json({
      success: false,
      error: "❌ Chyba při vkládání jídel",
    });
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
