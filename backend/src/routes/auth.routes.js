const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("../db/pool");
const { authLimiter } = require("../middleware/rateLimit");

const router = express.Router();

// -----------------------------------------------------
// REGISTER
// -----------------------------------------------------
router.post("/register", authLimiter, async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      success: false,
      error: "DB nedostupná",
    });
  }

  try {
    const { identifier, password } = req.body;

    // základní validace
    if (
      !identifier ||
      !password ||
      identifier.length < 3 ||
      password.length < 4
    ) {
      return res.json({
        success: false,
        error: "Neplatné jméno nebo heslo",
      });
    }

    // rezervovaná jména
    if (["admin", "manager"].includes(identifier.toLowerCase())) {
      return res.json({
        success: false,
        error: "Rezervované jméno",
      });
    }

    // kontrola existence
    const exists = await pool.query(
      "SELECT id FROM users WHERE identifier=$1",
      [identifier]
    );

    if (exists.rowCount > 0) {
      return res.json({
        success: false,
        error: "Uživatel už existuje",
      });
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
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

// -----------------------------------------------------
// LOGIN
// -----------------------------------------------------
router.post("/login", authLimiter, async (req, res) => {
  if (!pool) {
    return res.status(503).json({
      success: false,
      error: "DB nedostupná",
    });
  }

  try {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.json({
        success: false,
        error: "Chybí přihlašovací údaje",
      });
    }

    const r = await pool.query(
      "SELECT * FROM users WHERE identifier=$1",
      [identifier]
    );

    // jednotná hláška – neprozrazuje, co je špatně
    if (!r.rowCount) {
      return res.json({
        success: false,
        error: "Neplatné přihlašovací údaje",
      });
    }

    const u = r.rows[0];
    const ok = await bcrypt.compare(password, u.password_hash);

    if (!ok) {
      return res.json({
        success: false,
        error: "Neplatné přihlašovací údaje",
      });
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
    res.status(500).json({
      success: false,
      error: "Server error",
    });
  }
});

module.exports = router;
