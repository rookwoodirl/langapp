import Anthropic from '@anthropic-ai/sdk';
import { recordApiCost, CostSource } from './apiCosts';

const MODEL_RATES: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6':        { input: 3.0,  output: 15.0 },
  'claude-haiku-4-5-20251001': { input: 0.8,  output: 4.0  },
};

export interface LLMParams {
  source: CostSource;
  apiKey: string;
  model: string;
  maxTokens: number;
  system?: string;
  messages: Anthropic.MessageParam[];
}

export interface LLMResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export async function callLLM(params: LLMParams): Promise<LLMResult> {
  const { source, apiKey, model, maxTokens, system, messages } = params;
  if (!apiKey) throw new Error('No API key set.');

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const req: Parameters<typeof client.messages.create>[0] = {
    model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system } : {}),
  };

  const message = await client.messages.create(req);
  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type from Claude');

  const rates = MODEL_RATES[model] ?? { input: 3.0, output: 15.0 };
  recordApiCost({
    source,
    model,
    inputCreditRate: rates.input,
    totalInputCredits: message.usage.input_tokens,
    outputCreditRate: rates.output,
    totalOutputCredits: message.usage.output_tokens,
  });

  return {
    text: content.text,
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
  };
}
