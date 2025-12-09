const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "../frontend")));

const db = new sqlite3.Database("./database.db");

// ---------- TABULKY ----------
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    identifier TEXT UNIQUE,
    credit INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS foods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    price INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS menu (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    foodId INTEGER,
    maxCount INTEGER,
    ordered INTEGER DEFAULT 0
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    date TEXT,
    itemNames TEXT,
    price INTEGER,
    status TEXT DEFAULT 'ok'
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS topups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId INTEGER,
    amount INTEGER,
    done INTEGER DEFAULT 0
  )`);
});

// ADMIN + MANAGER
const ADMINS = {
  admin: "1973",
  manager: "123"
};

// ---------- LOGIN ----------
app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body;

  if (ADMINS[identifier] && ADMINS[identifier] !== password) {
    return res.json({ success: false, error: "Špatné heslo" });
  }

  db.get("SELECT * FROM users WHERE identifier=?", [identifier], (e, row) => {
    if (!row) {
      db.run(
        "INSERT INTO users(identifier,credit) VALUES(?,0)",
        [identifier],
        function () {
          res.json({
            success: true,
            userId: this.lastID,
            credit: 0,
            role: ADMINS[identifier] ? "admin" : "user"
          });
        }
      );
    } else {
      res.json({
        success: true,
        userId: row.id,
        credit: row.credit,
        role: ADMINS[identifier] ? "admin" : "user"
      });
    }
  });
});

// ---------- FOODS ----------
app.get("/api/foods", (req, res) => {
  db.all("SELECT * FROM foods", (e, rows) => res.json(rows || []));
});

// ---------- ADMIN MENU ----------
app.get("/api/admin/menu", (req, res) => {
  const date = req.query.date;

  db.all(
    `SELECT menu.id, foods.name, foods.price, menu.maxCount
     FROM menu JOIN foods ON foods.id = menu.foodId
     WHERE menu.date = ?`,
    [date],
    (e, rows) => res.json(rows || [])
  );
});

app.post("/api/admin/menu/add", (req, res) => {
  const { date, foodId, maxCount } = req.body;

  db.run(
    "INSERT INTO menu(date,foodId,maxCount,ordered) VALUES(?,?,?,0)",
    [date, foodId, maxCount],
    function () {
      db.all(
        `SELECT menu.id, foods.name, foods.price, menu.maxCount
         FROM menu JOIN foods ON foods.id = menu.foodId
         WHERE menu.date = ?`,
        [date],
        (e, rows) => res.json({ success: true, items: rows || [] })
      );
    }
  );
});

app.post("/api/admin/menu/update", (req, res) => {
  const { id, maxCount } = req.body;
  db.run("UPDATE menu SET maxCount=? WHERE id=?", [maxCount, id], () =>
    res.json({ success: true })
  );
});

app.post("/api/admin/menu/delete", (req, res) => {
  db.run("DELETE FROM menu WHERE id=?", [req.body.id], () =>
    res.json({ success: true })
  );
});

// ---------- MENU PRO UŽIVATELE ----------
app.get("/api/menu", (req, res) => {
  const date = req.query.date;

  db.all(
    `SELECT foods.name, foods.price, menu.maxCount, menu.ordered
     FROM menu JOIN foods ON foods.id = menu.foodId
     WHERE menu.date=?`,
    [date],
    (e, rows) => {
      res.json(
        (rows || []).map(r => ({
          name: r.name,
          price: r.price,
          maxCount: r.maxCount,
          remaining: r.maxCount - r.ordered
        }))
      );
    }
  );
});

// ---------- OBJEDNÁVKA + KONTROLA SKLADU ----------
app.post("/api/order", (req, res) => {
  const { userId, date, items } = req.body;
  const total = items.reduce((s, i) => s + i.price, 0);

  const grouped = {};
  items.forEach(i => grouped[i.name] = (grouped[i.name] || 0) + 1);

  db.all(
    `SELECT foods.name, menu.maxCount, menu.ordered
     FROM menu JOIN foods ON foods.id = menu.foodId
     WHERE menu.date=?`,
    [date],
    (err, rows) => {
      for (let n in grouped) {
        const row = rows.find(r => r.name === n);
        if (!row || row.ordered + grouped[n] > row.maxCount) {
          return res.json({ success: false, error: "Není dostatek kusů na skladě" });
        }
      }

      db.get("SELECT credit FROM users WHERE id=?", [userId], (e, u) => {
        if (u.credit < total)
          return res.json({ success: false, error: "Nedostatečný kredit" });

        db.run("UPDATE users SET credit=credit-? WHERE id=?", [total, userId]);

        items.forEach(i => {
          db.run(
            `UPDATE menu SET ordered=ordered+1 
             WHERE date=? AND foodId=(SELECT id FROM foods WHERE name=?)`,
            [date, i.name]
          );
        });

        db.run(
          "INSERT INTO orders(userId,date,itemNames,price,status) VALUES(?,?,?,?,?)",
          [userId, date, items.map(i => i.name).join(", "), total, "ok"]
        );

        res.json({ success: true, credit: u.credit - total });
      });
    }
  );
});

// ---------- HISTORIE ----------
app.get("/api/orders/history", (req, res) => {
  db.all(
    "SELECT id, date, itemNames, price FROM orders WHERE userId=? AND status='ok' ORDER BY date DESC",
    [req.query.userId],
    (err, rows) => res.json(rows || [])
  );
});

// ---------- ZRUŠENÍ OBJEDNÁVKY ----------
app.post("/api/orders/cancel", (req, res) => {
  const { orderId } = req.body;

  db.get("SELECT * FROM orders WHERE id=?", [orderId], (e, order) => {
    if (!order) return res.json({ success: false });

    const today = new Date().toISOString().slice(0, 10);
    if (order.date <= today) {
      return res.json({ success: false, error: "Objednávku lze zrušit jen den dopředu!" });
    }

    const items = order.itemNames.split(", ");

    items.forEach(name => {
      db.run(
        `UPDATE menu SET ordered=ordered-1 
         WHERE date=? AND foodId=(SELECT id FROM foods WHERE name=?)`,
        [order.date, name]
      );
    });

    db.run(
      "UPDATE users SET credit = credit + ? WHERE id=?",
      [order.price, order.userId],
      () => {
        db.run(
          "UPDATE orders SET status='cancelled' WHERE id=?",
          [orderId],
          () => {
            db.get(
              "SELECT credit FROM users WHERE id=?",
              [order.userId],
              (err2, u) => {
                res.json({ success: true, credit: u ? u.credit : undefined });
              }
            );
          }
        );
      }
    );
  });
});

// ---------- QR ----------
app.post("/api/topup", (req, res) => {
  db.run(
    "INSERT INTO topups(userId,amount,done) VALUES(?,?,0)",
    [req.body.userId, req.body.amount],
    function () {
      res.json({
        success: true,
        paymentId: this.lastID,
        qr: `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${this.lastID}`
      });
    }
  );
});

app.get("/api/topup/status", (req, res) => {
  db.get("SELECT * FROM topups WHERE id=?", [req.query.id], (e, r) => {
    if (!r) return res.json({ done: false, credit: 0 });

    if (!r.done) {
      db.run("UPDATE topups SET done=1 WHERE id=?", [r.id]);
      db.run("UPDATE users SET credit = credit + ? WHERE id=?", [r.amount, r.userId]);
    }

    db.get("SELECT credit FROM users WHERE id=?", [r.userId], (e2, u) => {
      res.json({ done: true, credit: u.credit });
    });
  });
});

// ---------- STATISTIKY – 30 DNÍ ----------
app.get("/api/admin/stats/month", (req, res) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const dateStr = since.toISOString().slice(0, 10);

  db.all(
    "SELECT itemNames, price FROM orders WHERE date >= ? AND status='ok'",
    [dateStr],
    (err, rows) => {
      let total = 0;
      const foods = {};

      rows.forEach(o => {
        total += o.price;
        o.itemNames.split(", ").forEach(n => {
          foods[n] = (foods[n] || 0) + 1;
        });
      });

      const topFoods = Object.entries(foods)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);

      res.json({ total, topFoods });
    }
  );
});

// ---------- SOUČET OBJEDNÁVEK NA DEN ----------
app.get("/api/admin/stats/day", (req, res) => {
  const date = req.query.date;

  db.all(
    "SELECT itemNames FROM orders WHERE date=? AND status='ok'",
    [date],
    (err, rows) => {
      const sum = {};

      rows.forEach(o => {
        o.itemNames.split(", ").forEach(n => {
          sum[n] = (sum[n] || 0) + 1;
        });
      });

      res.json(sum);
    }
  );
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("✅ Backend běží na portu " + PORT);
});
