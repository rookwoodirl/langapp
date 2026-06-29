import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const connectionString = process.env.POSTGRES_CONNSTRING ?? '';
const isInternal = connectionString.includes('.railway.internal');

export const pool = new Pool({
  connectionString,
  ssl: isInternal ? false : { rejectUnauthorized: false },
});
