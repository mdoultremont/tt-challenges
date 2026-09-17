import { config } from 'dotenv';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';

config();
config({ path: '../../.env' });

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://brain:brain@localhost:5432/secondbrain';

export const pool = new Pool({ connectionString });
export const db = drizzle({ client: pool });
