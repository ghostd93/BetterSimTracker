export function stripHiddenReasoningBlocks(raw: string): string {
  return String(raw ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<\s*(think|analysis|reasoning)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(think|analysis|reasoning)[^>]*>/gi, "")
    .trim();
}

export function sanitizeGeneratedSummaryText(raw: string): string {
  let text = stripHiddenReasoningBlocks(raw);
  if (!text) return "";

  const fencedBlock = text.match(/^```(?:[a-zA-Z0-9_-]+)?\s*([\s\S]*?)\s*```$/);
  if (fencedBlock?.[1]) {
    text = fencedBlock[1].trim();
  }

  text = text
    .replace(/^summary\s*[:\-]\s*/i, "")
    .replace(/^system\s*summary\s*[:\-]\s*/i, "")
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .trim();

  return text.slice(0, 1200).trim();
}

export function normalizeSummaryProse(text: string): string {
  let prose = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!prose) return "";

  prose = prose
    .split("\n")
    .map(line => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .join(" ");

  prose = prose
    .replace(/^["'`]+/, "")
    .replace(/["'`]+$/, "")
    .replace(/^\{[\s\S]*\}$/m, "")
    .trim();

  prose = prose
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/[ \t]+/g, " ")
    .trim();

  if (!prose) return "";
  if (!/[.!?]$/.test(prose)) {
    prose = `${prose}.`;
  }
  return prose.slice(0, 1000).trim();
}

export function wrapAsSystemNarrativeText(text: string): string {
  const cleaned = text.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  return `*${cleaned}*`;
}

export function hasNumericCharacters(text: string): boolean {
  return /\d/.test(text);
}

export function countSummarySentences(text: string): number {
  const matches = String(text ?? "").match(/[.!?]+(?:\s|$)/g);
  return matches?.length ?? 0;
}

