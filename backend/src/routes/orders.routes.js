const express = require("express");
const pool = require("../db/pool");
const { auth } = require("../middleware/auth");

const router = express.Router();

// -----------------------------------------------------
// OBJEDNÁVKA + SKLAD + KREDIT
// -----------------------------------------------------
router.post("/order", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

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
      FROM menu
      JOIN foods ON foods.id = menu.foodId
      WHERE menu.date = $1
      `,
      [date]
    );

    for (const name in grouped) {
      const row = menuRes.rows.find((r) => r.name === name);
      if (!row || row.ordered + grouped[name] > row.maxcount) {
        await client.query("ROLLBACK");
        return res.json({ success: false, error: "Nedostatek kusů" });
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
      INSERT INTO orders (userid, date, itemnames, price, status)
      VALUES ($1, $2, $3, $4, 'ok')
      `,
      [userId, date, names, total]
    );

    await client.query("COMMIT");

    res.json({ success: true, credit: u.rows[0].credit - total });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error(err);
    res.status(500).json({ success: false, error: "Server error" });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
// HISTORIE OBJEDNÁVEK
// -----------------------------------------------------
router.get("/orders/history", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json([]);
  }

  const r = await pool.query(
    `
    SELECT id, date, itemnames, price, status, shown
    FROM orders
    WHERE userid=$1
    ORDER BY date DESC, id DESC
    `,
    [req.user.id]
  );

  res.json(r.rows || []);
});


//RUŠENÍ OBJEDNÁVKY
router.post("/orders/cancel", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

  const client = await pool.connect();

  try {
    const { orderId } = req.body;
    const userId = req.user.id;

    await client.query("BEGIN");

    // 1️⃣ objednávka MUSÍ patřit uživateli
    const r = await client.query(
      `SELECT * FROM orders WHERE id = $1 AND userid = $2 FOR UPDATE`,
      [orderId, userId]
    );

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.json({ success: false, error: "Objednávka nenalezena" });
    }

    const order = r.rows[0];
    
    if (order.status !== "ok") {
  await client.query("ROLLBACK");
  return res.json({
    success: false,
    error: "Objednávka už byla zrušena",
  });
}

if (order.shown === true) {
  await client.query("ROLLBACK");
  return res.json({
    success: false,
    error: "Objednávku už nelze zrušit (byla ukázána kuchyni)",
  });
}

    const today = new Date().toISOString().slice(0, 10);

    // 2️⃣ ochrana proti zrušení v den objednávky
    if (order.date <= today) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávku lze zrušit jen den dopředu",
      });
    }

    // 3️⃣ vrácení položek do menu
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

    // 4️⃣ vrácení kreditu
    await client.query(
      `UPDATE users SET credit = credit + $1 WHERE id = $2`,
      [order.price, userId]
    );

    // 5️⃣ zrušení objednávky
    await client.query(
      `UPDATE orders SET status = 'cancelled' WHERE id = $1`,
      [orderId]
    );

    // 6️⃣ VRÁCENÍ NOVÉHO KREDITU (správně!)
    const u = await client.query(
      `SELECT credit FROM users WHERE id = $1`,
      [userId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      credit: u.rows[0].credit,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("CANCEL ORDER ERROR:", err);
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
});


// -----------------------------------------------------
// SHOW ORDER (potvrzení kuchyni)
// -----------------------------------------------------
router.post("/orders/:id/show", auth, async (req, res) => {
  const client = await pool.connect();

  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    await client.query("BEGIN");

    const r = await client.query(
      `
      SELECT id, shown
      FROM orders
      WHERE id = $1 AND userid = $2
      FOR UPDATE
      `,
      [orderId, userId]
    );

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({ success: false });
    }

    if (r.rows[0].shown) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávka už byla ukázána",
      });
    }

    // 🔢 GENERUJEME VÝDEJOVÉ ČÍSLO
    const code = "A-" + Math.floor(100 + Math.random() * 900);

    await client.query(
      `
      UPDATE orders
      SET shown = true,
          shown_at = NOW(),
          pickup_code = $1
      WHERE id = $2
      `,
      [code, orderId]
    );

    await client.query("COMMIT");

    res.json({
      success: true,
      pickupCode: code,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SHOW ORDER error:", err);
    res.status(500).json({ success: false });
  } finally {
    client.release();
  }
});

// -----------------------------------------------------
// KUCHYNĚ – ČEKAJÍCÍ OBJEDNÁVKY
// -----------------------------------------------------
router.get("/kitchen/orders", auth, async (req, res) => {
  if (!["admin", "manager", "kitchen"].includes(req.user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }

  const r = await pool.query(`
    SELECT id, date, itemnames, shown_at, pickup_code
    FROM orders
    WHERE shown = true
      AND status = 'ok'
      AND issued = false
    ORDER BY shown_at ASC
  `);

  res.json(r.rows);
});

// -----------------------------------------------------
// SHOW ORDER (ukázání objednávky kuchyni)
// -----------------------------------------------------
router.post("/orders/:id/show", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      success: false,
      error: "DB nedostupná",
    });
  }

  const client = await pool.connect();

  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    await client.query("BEGIN");

    // 1️⃣ ověření, že objednávka patří uživateli
    const r = await client.query(
      `
      SELECT id, shown, status
      FROM orders
      WHERE id = $1 AND userid = $2
      FOR UPDATE
      `,
      [orderId, userId]
    );

    if (!r.rowCount) {
      await client.query("ROLLBACK");
      return res.status(404).json({
        success: false,
        error: "Objednávka nenalezena",
      });
    }

    const order = r.rows[0];

    if (order.status !== "ok") {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávka není aktivní",
      });
    }

    if (order.shown === true) {
      await client.query("ROLLBACK");
      return res.json({
        success: false,
        error: "Objednávka už byla ukázána kuchyni",
      });
    }

    // 2️⃣ vygenerování výdejního čísla (pickup_code)
    const pickupCode = Math.floor(100 + Math.random() * 900); // 100–999

    // 3️⃣ označení objednávky jako ukázané
    await client.query(
      `
      UPDATE orders
      SET shown = true,
          shown_at = NOW(),
          pickup_code = $2
      WHERE id = $1
      `,
      [orderId, pickupCode]
    );

    await client.query("COMMIT");

    // 4️⃣ návrat čísla uživateli
    res.json({
      success: true,
      pickupCode,
    });

  } catch (err) {
    await client.query("ROLLBACK");
    console.error("SHOW ORDER ERROR:", err);
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  } finally {
    client.release();
  }
});



module.exports = router;
