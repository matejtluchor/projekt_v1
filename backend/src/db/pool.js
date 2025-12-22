const { Pool } = require("pg");

let pool = null;

if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
  });

  pool.on("connect", () => {
    console.log("✅ DB pool vytvořen");
  });
} else {
  console.warn("⚠️ DATABASE_URL není nastaven – DB vypnutá");
}

module.exports = pool;
