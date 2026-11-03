export function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return undefined;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return undefined;
  }
}

/** Long strings keep 50 + `[...]` + 50; data URIs keep the type prefix. */
export function truncateWithContext(text: string, edgeLen = 50): string {
  if (text.startsWith('data:') && text.includes(',')) {
    return text.slice(0, text.indexOf(','));
  }
  if (text.length > edgeLen * 2 + 10) {
    return `${text.slice(0, edgeLen)}[...]${text.slice(-edgeLen)}`;
  }
  return text;
}

export function processPayloadRecursive(value: unknown): unknown {
  if (typeof value === 'string') return truncateWithContext(value, 50);
  if (Array.isArray(value)) {
    if (value.length > 3) {
      const sample = value.slice(0, 2).map((item) => processPayloadRecursive(item));
      return `items[${value.length}]: [${JSON.stringify(sample).slice(1, -1)}...]`;
    }
    return value.map((item) => processPayloadRecursive(item));
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = processPayloadRecursive(nested);
    }
    return out;
  }
  return value;
}

export function hasMeaningfulData(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

export function extractSchemaOnly(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type === 'string') return 'string';
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[${extractSchemaOnly(value[0], depth + 1)}]×${value.length}`;
  }
  if (type === 'object') {
    if (depth > 3) return '{...}';
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    if (depth === 0) {
      const fields = keys.map((key) => {
        const nested = (value as Record<string, unknown>)[key];
        if (typeof nested === 'object' && nested !== null) return key;
        return `${key}:${extractSchemaOnly(nested, depth + 1)}`;
      });
      return `{${fields.join(', ')}}`;
    }
    return `{${keys.join(', ')}}`;
  }
  return String(value);
}

export function summarizeResponseBody(body: string): string {
  const parsed = tryParseJson(body);
  if (parsed !== undefined && typeof parsed === 'object' && parsed !== null) {
    return extractSchemaOnly(parsed);
  }
  return truncateWithContext(body);
}

export function compactBody(body: string): unknown {
  const parsed = tryParseJson(body);
  if (parsed !== undefined) return processPayloadRecursive(parsed);
  return truncateWithContext(body);
}

export function compactIngestData(data: unknown): unknown {
  const compacted = processPayloadRecursive(data);
  return hasMeaningfulData(compacted) ? compacted : undefined;
}

export function flattenSnapshotMarkdown(markdown: string): string {
  const escaped = markdown.replaceAll('¶', '\\¶');
  return escaped.replace(/\n+/g, ' ¶ ').trim();
}
