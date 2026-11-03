// The old backend overwrote events.json in place with a shorter array and left leftover bytes.

export function leadingJsonValue(text: string): string | null {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === undefined) continue;
    if (start === -1) {
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') continue;
      if (ch !== '[' && ch !== '{') return null;
      start = i;
      depth = 1;
      continue;
    }
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '[' || ch === '{') {
      depth += 1;
      continue;
    }
    if (ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}
