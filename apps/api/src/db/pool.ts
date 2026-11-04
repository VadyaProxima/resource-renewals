import pg from "pg";
// Calendar dates must never pass through JS Date or the machine's timezone.
pg.types.setTypeParser(1082, (value: string) => value);
export function createPool(connectionString: string) {
  const pool = new pg.Pool({
    connectionString,
    max: 12,
    connectionTimeoutMillis: 5000,
  });
  pool.on("error", () => console.error("Idle database connection lost"));
  return pool;
}
export type Pool = pg.Pool;
export type Client = pg.PoolClient;
export async function transaction<T>(
  pool: Pool,
  work: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
