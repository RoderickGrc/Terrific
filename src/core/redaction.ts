const REDACTED = '<REDACTED>';

// password, passwd, passphrase, passcode, pass, pwd, plus prefixed/suffixed password keys
const PASSWORD_KEY = /pass(word|wd|phrase|code)|^pass$|^pwd$/i;

const SENSITIVE_EXACT = new Set(['token', 'secret', 'authorization', 'cookie', 'apikey']);

export function isSensitiveKey(key: string): boolean {
  if (PASSWORD_KEY.test(key)) return true;
  const normalized = key.replace(/[-_]/g, '').toLowerCase();
  return SENSITIVE_EXACT.has(normalized);
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}

function redactPairs(text: string): string {
  // `?` is excluded from keys so the query separator never becomes part of the first key.
  return text.replace(/(^|[?&;])([^=&#;?]+)=([^&#;]*)/g, (match, sep: string, key: string) =>
    isSensitiveKey(safeDecode(key)) ? `${sep}${key}=${REDACTED}` : match,
  );
}

export function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(nested);
    }
    return out;
  }
  return value;
}

export function redactUrl(url: string): string {
  const queryStart = url.indexOf('?');
  if (queryStart === -1) return url;
  return url.slice(0, queryStart) + redactPairs(url.slice(queryStart));
}

export function redactText(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      return JSON.stringify(redactValue(JSON.parse(trimmed)));
    } catch {
      // not JSON; treat as form text
    }
  }
  return redactPairs(text);
}
