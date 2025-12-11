const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");

const DB_URL = process.env.DATABASE_URL;
const BACKUP_DIR = path.join(__dirname, "../backups");

// vytvořit složku
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

// vytvořit název souboru
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupFile = path.join(BACKUP_DIR, `backup-${timestamp}.sql`);

console.log("🟡 Spouštím zálohování DB...");

const cmd = `pg_dump "${DB_URL}" > "${backupFile}"`;

exec(cmd, (err) => {
  if (err) {
    console.error("❌ Chyba při zálohování:", err);
    process.exit(1);
  }

  console.log("✅ Záloha hotová:", backupFile);
  process.exit(0);
});
