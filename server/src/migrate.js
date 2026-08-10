import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'migrations');

async function main() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  await conn.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    id INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_migrations_name (name)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  const [rows] = await conn.query('SELECT name FROM schema_migrations');
  const applied = new Set(rows.map((r) => r.name));

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`applying ${file} ...`);
    await conn.query(sql);
    await conn.query('INSERT INTO schema_migrations (name) VALUES (?)', [file]);
  }

  console.log('migrations done');
  await conn.end();
}

main().catch((err) => {
  console.error('migration failed:', err.message);
  process.exit(1);
});
