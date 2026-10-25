import {Pool, PoolClient} from 'pg';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const globalDb = globalThis as unknown as {lnPool?: Pool};
export const pool = globalDb.lnPool ?? new Pool({connectionString:url, max:10});
if (process.env.NODE_ENV !== 'production') globalDb.lnPool = pool;

export async function transaction<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}
