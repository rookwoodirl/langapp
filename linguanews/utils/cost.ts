// Claude Sonnet 4.6 pricing
const SONNET_IN = 3.0;
const SONNET_OUT = 15.0;

// Claude Haiku 4.5 pricing (used for conjugations)
const HAIKU_IN = 0.8;
const HAIKU_OUT = 4.0;

export function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * SONNET_IN + (outputTokens / 1_000_000) * SONNET_OUT;
}

export function calcCostHaiku(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * HAIKU_IN + (outputTokens / 1_000_000) * HAIKU_OUT;
}

export function formatCost(cost: number): string {
  if (cost === 0) return '$0.000';
  if (cost < 0.001) return '<$0.001';
  return `$${cost.toFixed(3)}`;
}

export function formatTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}
