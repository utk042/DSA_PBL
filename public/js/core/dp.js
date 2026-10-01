// Stage 2 and Stage 9 — Dynamic Programming.
//   lcs()       Longest Common Subsequence, O(mn). Used to merge topic-name
//               variants and to compare the topic sequences of two papers.
//   knapsack()  0/1 Knapsack, O(nW). The revision-time allocator.

/**
 * LCS of two sequences (strings or arrays). Returns the length and one
 * longest common subsequence, reconstructed from the full DP table.
 */
export function lcs(a, b, eq = (x, y) => x === y) {
  const m = a.length;
  const n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = eq(a[i - 1], b[j - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const seq = [];
  for (let i = m, j = n; i > 0 && j > 0;) {
    if (eq(a[i - 1], b[j - 1])) { seq.push(a[i - 1]); i--; j--; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--;
    else j--;
  }
  return { length: dp[m][n], sequence: seq.reverse() };
}

/** Length-only LCS using two rows, O(mn) time and O(n) space. */
export function lcsLength(a, b) {
  let prev = new Uint16Array(b.length + 1);
  let cur = new Uint16Array(b.length + 1);
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    [prev, cur] = [cur, prev];
    cur.fill(0);
  }
  return prev[b.length];
}

/** similarity(a, b) = LCS(a, b) / max(|a|, |b|) — Section 5.6 of the report. */
export function similarity(a, b) {
  const longest = Math.max(a.length, b.length);
  return longest === 0 ? 1 : lcsLength(a, b) / longest;
}

/**
 * 0/1 Knapsack. Item weights are study hours, which may be fractional, so
 * they are scaled to integer slots (default: half-hours) before the DP.
 *
 * items: [{ key, hours, value }]
 * returns { value, hours, chosen: [key], slots }
 */
export function knapsack(items, budgetHours, slotsPerHour = 2) {
  const W = Math.max(0, Math.floor(budgetHours * slotsPerHour + 1e-9));
  const n = items.length;
  const w = items.map((it) => Math.max(1, Math.ceil(it.hours * slotsPerHour - 1e-9)));
  // dp[i][c] = best value using the first i items within capacity c
  const dp = Array.from({ length: n + 1 }, () => new Float64Array(W + 1));
  for (let i = 1; i <= n; i++) {
    const wi = w[i - 1];
    const vi = items[i - 1].value;
    for (let c = 0; c <= W; c++) {
      dp[i][c] = dp[i - 1][c];
      if (wi <= c && dp[i - 1][c - wi] + vi > dp[i][c]) dp[i][c] = dp[i - 1][c - wi] + vi;
    }
  }
  const chosen = [];
  for (let i = n, c = W; i > 0; i--) {
    if (dp[i][c] !== dp[i - 1][c]) { chosen.push(items[i - 1].key); c -= w[i - 1]; }
  }
  chosen.reverse();
  const picked = new Set(chosen);
  const hours = items.filter((it) => picked.has(it.key)).reduce((s, it) => s + it.hours, 0);
  return { value: dp[n][W], hours, chosen, slots: W };
}

/** Greedy-by-value baseline the Knapsack is compared against (Section 7). */
export function greedyByValue(items, budgetHours) {
  const order = [...items].sort((a, b) => b.value - a.value || a.hours - b.hours);
  let left = budgetHours;
  let value = 0;
  const chosen = [];
  for (const it of order) {
    if (it.hours <= left + 1e-9) { chosen.push(it.key); left -= it.hours; value += it.value; }
  }
  return { value, hours: budgetHours - left, chosen };
}
