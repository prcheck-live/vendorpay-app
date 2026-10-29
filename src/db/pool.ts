import { Pool, PoolClient, types } from 'pg';
import { config } from '../config';

// Keep SQL DATE columns as 'YYYY-MM-DD' strings; converting them to JS Dates shifts the day by time zone.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
