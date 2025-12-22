// backend/server.js
require("dotenv").config();

const express = require("express");
const path = require("path");

const pool = require("./src/db/pool");
const { auth, adminOnly } = require("./src/middleware/auth");

const authRoutes = require("./src/routes/auth.routes");
const menuRoutes = require("./src/routes/menu.routes");
const ordersRoutes = require("./src/routes/orders.routes");
const adminRoutes = require("./src/routes/admin.routes");
const topupRoutes = require("./src/routes/topup.routes");

const app = express();

// -----------------------------------------------------
// MIDDLEWARE
// -----------------------------------------------------
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

app.use("/api", authRoutes);
app.use("/api", menuRoutes);
app.use("/api", ordersRoutes);
app.use("/api", adminRoutes);
app.use("/api", topupRoutes);

// -----------------------------------------------------
// LOGOVÁNÍ REQUESTŮ
// -----------------------------------------------------
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// -----------------------------------------------------
// INIT DB
// -----------------------------------------------------
async function initDb() {
  if (!pool) {
    console.warn("⚠️ DB není dostupná – initDb přeskočeno");
    return;
  }

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

  console.log("✅ DB připravena");
}

// -----------------------------------------------------
//  CLEANUP – mazání starých objednávek
// -----------------------------------------------------
async function cleanupOldOrders() {
  if (!pool) return;

  try {
    const r = await pool.query(`
      DELETE FROM orders
      WHERE date < (CURRENT_DATE - INTERVAL '14 days')
    `);

    if (r.rowCount > 0) {
      console.log(`🧹 Cleanup: smazáno ${r.rowCount} starých objednávek`);
    }
  } catch (err) {
    console.error("❌ Cleanup error:", err);
  }
}

// -----------------------------------------------------
// FOODS (ADMIN)
// -----------------------------------------------------
app.get("/api/foods", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json([]);
  }

  const r = await pool.query("SELECT * FROM foods ORDER BY id ASC");
  res.json(r.rows || []);
});

// -----------------------------------------------------
// HEALTH CHECK
// -----------------------------------------------------
app.get("/api/health", (req, res) => {
  res.json({ status: "ok" });
});


// -----------------------------------------------------
// START
// -----------------------------------------------------
const PORT = process.env.PORT || 3000;

(async () => {
  await initDb();
  await cleanupOldOrders(); // 👈 tady

  app.listen(PORT, () => {
    console.log("Server běží na portu " + PORT);
  });
})();

// -----------------------------------------------------
//  AUTOMATICKÝ CLEANUP – 1× za 24 hodin
// -----------------------------------------------------
setInterval(() => {
  cleanupOldOrders();
}, 24 * 60 * 60 * 1000);
