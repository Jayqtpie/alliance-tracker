// Work scales with row count and display budget, never the largest rank.
export function rankGaps(values: Iterable<number>, budget: number) {
  const ranks = [...new Set(values)].filter((rank) => Number.isSafeInteger(rank) && rank > 0).sort((a, b) => a - b);
  const missing: number[] = [];
  let total = 0;
  let previous = 0;
  for (const rank of ranks) {
    const gap = rank - previous - 1;
    total += gap;
    const count = Math.min(gap, Math.max(0, budget - missing.length));
    for (let offset = 1; offset <= count; offset += 1) missing.push(previous + offset);
    previous = rank;
  }
  return { missing, total };
}
