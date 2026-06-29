import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.POSTGRES_CONNSTRING,
  ssl: { rejectUnauthorized: false },
});
