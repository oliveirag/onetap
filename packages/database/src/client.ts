import pg from 'pg';

export interface QueryResult<T> {
  rows: T[];
  rowCount: number;
}

/** Minimal query surface shared by node-postgres and PGlite. */
export interface Queryable {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
}

export interface Database extends Queryable {
  /** Runs fn inside BEGIN/COMMIT; rolls back on any thrown error. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

// int8 -> number (simulated cents stay far below 2^53), numeric -> number, date -> 'YYYY-MM-DD'.
const INT8_OID = 20;
const NUMERIC_OID = 1700;
const DATE_OID = 1082;
pg.types.setTypeParser(INT8_OID, (v) => Number(v));
pg.types.setTypeParser(NUMERIC_OID, (v) => Number(v));
pg.types.setTypeParser(DATE_OID, (v) => v);

export function createPgDatabase(connectionString: string, options: { max?: number } = {}): Database {
  const pool = new pg.Pool({ connectionString, max: options.max ?? 10 });
  return {
    async query<T>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as unknown[]);
      return { rows: res.rows as T[], rowCount: res.rowCount ?? 0 };
    },
    async transaction<T>(fn: (tx: Queryable) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const tx: Queryable = {
          async query<R>(text: string, params?: unknown[]) {
            const res = await client.query(text, params as unknown[]);
            return { rows: res.rows as R[], rowCount: res.rowCount ?? 0 };
          },
        };
        const result = await fn(tx);
        await client.query('commit');
        return result;
      } catch (err) {
        await client.query('rollback').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export const PG_PARSERS = {
  [INT8_OID]: (v: string) => Number(v),
  [NUMERIC_OID]: (v: string) => Number(v),
  [DATE_OID]: (v: string) => v,
};

/** Postgres error helper: SQLSTATE of a driver error, if any. */
export function pgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === 'object' && 'code' in err && typeof (err as { code: unknown }).code === 'string') {
    return (err as { code: string }).code;
  }
  return undefined;
}

export const PG_UNIQUE_VIOLATION = '23505';
