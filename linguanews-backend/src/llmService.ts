import Anthropic from '@anthropic-ai/sdk';
import { pool } from './db';
import { checkBalance, chargeUsage, CREDIT_MARGIN } from './creditService';

const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':         { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8,  output: 4.0  },
};

export interface LLMCallParams {
  userId: string;
  source: string;
  model: string;
  maxTokens: number;
  language?: string;
  system?: string;
  messages: Anthropic.MessageParam[];
  description?: string;
  articleId?: string;
}

export interface LLMCallResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callLLM(params: LLMCallParams): Promise<LLMCallResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured on the server');

  const client = new Anthropic({ apiKey });
  const { userId, source, model, maxTokens, language, system, messages, description, articleId } = params;

  await checkBalance(userId);

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {}),
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const rates = MODEL_RATES[model] ?? { input: 3.0, output: 15.0 };
  await pool.query(
    `INSERT INTO api_costs
       (user_id, source, model, language, input_credit_rate, total_input_credits,
        output_credit_rate, total_output_credits, description, article_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      userId, source, model, language ?? null,
      rates.input, message.usage.input_tokens,
      rates.output, message.usage.output_tokens,
      description ?? null, articleId ?? null,
    ],
  );

  const costUsd = (message.usage.input_tokens / 1_000_000) * rates.input
    + (message.usage.output_tokens / 1_000_000) * rates.output;
  await chargeUsage(userId, source, costUsd * CREDIT_MARGIN);

  return {
    text: content.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
