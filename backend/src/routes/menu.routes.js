const express = require("express");
const pool = require("../db/pool");
const { auth, adminOnly } = require("../middleware/auth");

const router = express.Router();

// -----------------------------
// USER – MENU NA DEN
// -----------------------------
router.get("/menu", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json([]);
  }

  const date = req.query.date;

  const r = await pool.query(
    `
    SELECT foods.name, foods.price, menu.maxCount, menu.ordered
    FROM menu
    JOIN foods ON foods.id = menu.foodId
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

// -----------------------------
// ADMIN – MENU NA DEN
// -----------------------------
router.get("/admin/menu", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json([]);
  }

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

router.post("/admin/menu/add", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

  const { date, foodId, maxCount } = req.body;

  await pool.query(
    "INSERT INTO menu (date,foodId,maxCount,ordered) VALUES ($1,$2,$3,0)",
    [date, foodId, maxCount]
  );

  const r = await pool.query(
    `
    SELECT menu.id, foods.name, foods.price, menu.maxCount
    FROM menu
    JOIN foods ON foods.id = menu.foodId
    WHERE menu.date = $1
  `,
    [date]
  );

  res.json({ success: true, items: r.rows });
});

router.post("/admin/menu/update", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

  await pool.query("UPDATE menu SET maxCount=$1 WHERE id=$2", [
    req.body.maxCount,
    req.body.id,
  ]);

  res.json({ success: true });
});

router.post("/admin/menu/delete", auth, adminOnly, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

  await pool.query("DELETE FROM menu WHERE id=$1", [req.body.id]);

  res.json({ success: true });
});

module.exports = router;
