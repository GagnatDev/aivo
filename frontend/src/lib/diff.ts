// Line diff for profile version history (ME-7): small texts, exact LCS.

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/**
 * Line-level diff of two texts via longest-common-subsequence, removed lines
 * before added ones at each divergence. Profile bodies are short natural-language
 * documents, so the O(n·m) table is fine.
 */
export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  // lcs[i][j] = LCS length of a[i..] vs b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i]![j] =
        a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      lines.push({ kind: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      lines.push({ kind: "removed", text: a[i]! });
      i++;
    } else {
      lines.push({ kind: "added", text: b[j]! });
      j++;
    }
  }
  for (; i < a.length; i++) lines.push({ kind: "removed", text: a[i]! });
  for (; j < b.length; j++) lines.push({ kind: "added", text: b[j]! });
  return lines;
}
