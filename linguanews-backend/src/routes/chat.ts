import { Router, Request, Response } from 'express';
import { pool } from '../db';
import { callLLM } from '../llmService';
import { requireAuth } from '../middleware/auth';
import { InsufficientCreditsError } from '../creditService';

const router = Router();
router.use(requireAuth);

const MAX_ARTICLE_CONTEXT_CHARS = 8000;
const MAX_VOCAB_WORDS = 100;
const MAX_HISTORY_TURNS = 30;

const DIFFICULTY_GUIDE: Record<string, string> = {
  beginner:
    'Use very simple vocabulary and short sentences (roughly A1-A2 level). Stick mostly to the present tense and everyday topics.',
  intermediate:
    'Use everyday vocabulary and moderately complex sentences (roughly B1-B2 level). Mix tenses naturally.',
  advanced:
    'Use rich vocabulary, idioms, and complex sentence structures (roughly C1-C2 level). Converse as you would with a fluent speaker.',
};

interface ChatMessageBody {
  role: string;
  content: string;
}

router.post('/message', async (req: Request, res: Response) => {
  const userId = req.userId as string;
  const {
    mode,
    difficulty,
    target_language,
    native_language,
    messages,
    article_id,
    vocab_words,
    vocab_label,
  } = req.body;

  if (!mode || !difficulty || !target_language || !native_language || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: 'mode, difficulty, target_language, native_language, and a non-empty messages array are required',
    });
  }
  if (mode !== 'article' && mode !== 'vocab') {
    return res.status(400).json({ error: "mode must be 'article' or 'vocab'" });
  }
  if (!DIFFICULTY_GUIDE[difficulty as string]) {
    return res.status(400).json({ error: 'difficulty must be one of: beginner, intermediate, advanced' });
  }

  try {
    let contextBlock: string;
    let description: string | undefined;

    if (mode === 'article') {
      if (!article_id) {
        return res.status(400).json({ error: 'article_id is required for article mode' });
      }
      const article = await pool.query(
        `SELECT title FROM articles WHERE id = $1 AND user_id = $2 AND deleted = false`,
        [article_id, userId]
      );
      if (article.rowCount === 0) {
        return res.status(404).json({ error: 'Article not found for this user' });
      }
      const textRows = await pool.query(
        `SELECT translated FROM article_text WHERE article_id = $1 ORDER BY row_order`,
        [article_id]
      );
      const fullText = textRows.rows.map((r) => r.translated).join(' ').slice(0, MAX_ARTICLE_CONTEXT_CHARS);
      description = (article.rows[0].title as string) || undefined;
      contextBlock = `Article title: "${description ?? 'Untitled'}"\n\nArticle text (in ${target_language}):\n${fullText}`;
    } else {
      const words: string[] = Array.isArray(vocab_words) ? vocab_words.slice(0, MAX_VOCAB_WORDS) : [];
      if (words.length === 0) {
        return res.status(400).json({ error: 'vocab_words is required for vocab mode' });
      }
      contextBlock = `Vocabulary words to practice: ${words.join(', ')}`;
      description = (vocab_label as string) || undefined;
    }

    const difficultyGuide = DIFFICULTY_GUIDE[difficulty as string];

    const system =
      mode === 'article'
        ? `You are a friendly conversation partner helping a ${native_language} speaker practice ${target_language}. ` +
          `Discuss the following article with them, entirely in ${target_language}. ${difficultyGuide} ` +
          `Keep replies conversational and fairly short (2-4 sentences). Gently correct significant mistakes by modeling the correct form naturally in your reply, without being preachy about it.\n\n${contextBlock}`
        : `You are a friendly conversation partner helping a ${native_language} speaker practice ${target_language}. ` +
          `Have a natural conversation with them entirely in ${target_language} that gives them opportunities to use the vocabulary below. ${difficultyGuide} ` +
          `Keep replies conversational and fairly short (2-4 sentences). Try to naturally use several of the target words yourself and nudge the learner to use them too.\n\n${contextBlock}`;

    const claudeMessages = (messages as ChatMessageBody[])
      .slice(-MAX_HISTORY_TURNS)
      .map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      }));

    const result = await callLLM({
      userId,
      source: 'chat',
      model: 'claude-sonnet-4-6',
      maxTokens: 400,
      language: target_language as string,
      system,
      messages: claudeMessages,
      description,
      articleId: mode === 'article' ? (article_id as string) : undefined,
    });

    return res.json({ reply: result.text, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (err) {
    if (err instanceof InsufficientCreditsError) {
      return res.status(402).json({ error: 'insufficient_credits', balanceUsd: err.balanceUsd });
    }
    console.error('POST /chat/message error:', err);
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Chat failed' });
  }
});

export default router;
