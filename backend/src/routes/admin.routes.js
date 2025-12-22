const express = require("express");
const pool = require("../db/pool");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

// -----------------------------------------------------
// ADMIN STATISTIKY – MĚSÍC
// -----------------------------------------------------
router.get("/admin/stats/month", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ total: 0, topFoods: [] });
  }

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

// -----------------------------------------------------
// ADMIN STATISTIKY – DEN
// -----------------------------------------------------
router.get("/admin/stats/day", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json({});
  }

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

module.exports = router;
