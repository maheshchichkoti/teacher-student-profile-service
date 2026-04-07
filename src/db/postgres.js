import pg from 'pg';
import { config } from '../config.js';

const { Pool } = pg;

let pool;

export function getPgPool() {
  if (!config.postgres.host) return null;
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      user: config.postgres.user,
      password: config.postgres.password,
      database: config.postgres.database,
      max: 5,
    });
  }
  return pool;
}

/**
 * @param {string} text
 * @param {unknown[]} params
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function queryPg(text, params = []) {
  const p = getPgPool();
  if (!p) throw new Error('Postgres not configured (set POSTGRES_HOST)');
  const { rows } = await p.query(text, params);
  return rows;
}
