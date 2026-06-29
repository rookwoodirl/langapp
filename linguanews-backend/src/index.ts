import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { pool } from './db';
import articlesRouter from './routes/articles';

dotenv.config();

const app = express();
const PORT = process.env.PORT ?? 3000;

app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/dbcheck', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message, code: err.code });
  }
});

app.use('/articles', articlesRouter);

async function start() {
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
  } catch (err) {
    console.error('Database connection warning:', err);
  }
}

start();
