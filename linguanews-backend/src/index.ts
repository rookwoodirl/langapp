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

app.use('/articles', articlesRouter);

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('Database connected');
    app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
  } catch (err) {
    console.error('Failed to connect to database:', err);
    process.exit(1);
  }
}

start();
