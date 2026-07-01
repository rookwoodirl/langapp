import { getUserId } from './api';

const BACKEND_URL = (process.env.EXPO_PUBLIC_BACKEND_URL ?? '').replace(/\/$/, '');

export type CostSource = 'article' | 'article-regeneration' | 'vocab' | 'vocab_selection' | 'audio';

export async function recordApiCost(params: {
  source: CostSource;
  model: string;
  language?: string;
  inputCreditRate: number;
  totalInputCredits: number;
  outputCreditRate: number;
  totalOutputCredits: number;
}): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const userId = await getUserId();
    const res = await fetch(`${BACKEND_URL}/api-costs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        user_id: userId,
        source: params.source,
        model: params.model,
        language: params.language ?? null,
        input_credit_rate: params.inputCreditRate,
        total_input_credits: params.totalInputCredits,
        output_credit_rate: params.outputCreditRate,
        total_output_credits: params.totalOutputCredits,
      }),
    });
    if (!res.ok) {
      console.error(`recordApiCost: backend returned ${res.status} for source=${params.source}`);
    }
  } catch (err) {
    console.error('recordApiCost: network error', err);
  } finally {
    clearTimeout(timeout);
  }
}
