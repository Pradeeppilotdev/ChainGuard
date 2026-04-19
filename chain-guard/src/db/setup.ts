import { createClient } from '@libsql/client';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFileSync, existsSync, mkdirSync } from 'fs';

const getProjectRoot = () => {
  try {
    const packageJsonPath = resolve(process.cwd(), 'package.json');
    readFileSync(packageJsonPath);
    return process.cwd();
  } catch {
    return resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  }
};

const projectRoot = getProjectRoot();
const REPORTS_DB_URL = `file:${resolve(projectRoot, 'reports.db')}`;

export const client = createClient({ url: REPORTS_DB_URL });

let initialized = false;

export async function initReportsDatabase() {
  if (initialized) return;
  
  await client.execute(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      upi_id TEXT NOT NULL,
      markdown_result TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS upi_status (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      upi_id TEXT UNIQUE NOT NULL,
      is_blocked INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  await client.execute(`CREATE INDEX IF NOT EXISTS idx_upi_id ON upi_status(upi_id)`);
  
  initialized = true;
}

async function ensureInitialized() {
  if (!initialized) {
    await initReportsDatabase();
  }
}

export async function saveReport(params: {
  id: string;
  upiId: string;
  markdownResult: string;
}) {
  await ensureInitialized();
  await client.execute({
    sql: `INSERT INTO reports (id, upi_id, markdown_result) VALUES (?, ?, ?)`,
    args: [params.id, params.upiId, params.markdownResult],
  });
}

export async function updateUpiStatus(upiId: string, isBlocked: boolean) {
  await ensureInitialized();
  await client.execute({
    sql: `INSERT INTO upi_status (upi_id, is_blocked, updated_at) 
          VALUES (?, ?, datetime('now'))
          ON CONFLICT(upi_id) DO UPDATE SET is_blocked = ?, updated_at = datetime('now')`,
    args: [upiId, isBlocked ? 1 : 0, isBlocked ? 1 : 0],
  });
}

export async function getReport(id: string) {
  const result = await client.execute({
    sql: `SELECT * FROM reports WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] || null;
}

export async function getUpiStatus(upiId: string) {
  const result = await client.execute({
    sql: `SELECT is_blocked FROM upi_status WHERE upi_id = ?`,
    args: [upiId],
  });
  return result.rows[0] ? result.rows[0].is_blocked === 1 : null;
}