const express = require("express");
const pool = require("../db/pool");
const { auth } = require("../middleware/auth");

const router = express.Router();

// -----------------------------------------------------
// TOPUP – VYTVOŘENÍ QR
// -----------------------------------------------------
router.post("/topup", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ success: false });
  }

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

// -----------------------------------------------------
// TOPUP – STATUS
// -----------------------------------------------------
router.get("/topup/status", auth, async (req, res) => {
  if (!pool) {
    return res.status(503).json({ done: false, credit: 0 });
  }

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

module.exports = router;
