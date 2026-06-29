// Claude Sonnet 4.6 pricing
const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

export function calcCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * INPUT_COST_PER_M + (outputTokens / 1_000_000) * OUTPUT_COST_PER_M;
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
