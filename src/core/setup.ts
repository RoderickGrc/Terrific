export type Target = 'browser' | 'none';

export type RecordOptions = {
  actions: boolean;
  network: boolean;
  console: boolean;
};

export type SessionSetup = {
  target: Target;
  url: string;
  profile: string;
  record: RecordOptions;
  endpoint: string | null;
};

export type ProfileOption = {
  slug: string;
  label: string;
  detail: string;
  blockedReason?: string;
};

export type EndpointOption = {
  name: string;
  state: 'open' | 'closed';
  eventCount: number;
  lastEventAt: number | null;
};

const ENDPOINT_NAME = /^[a-z0-9][a-z0-9-]{0,31}$/;
const EXPLICIT_SCHEME = /^https?:\/\//i;
// A dotted host needs a letters-only last label, so words like `api.v2` or `v1.2` stay names.
const URL_WORD =
  /^(https?:\/\/)?(localhost|\[::1\]|(?:\d{1,3}\.){3}\d{1,3}|(?:[a-z0-9-]+\.)+[a-z]{2,})(?::\d+)?(?:\/\S*)?$/i;
const URL_ATTEMPT = /^(https?:|www\.)|:\/\//i;

export function isEndpointName(name: string): boolean {
  return ENDPOINT_NAME.test(name);
}

export function assignProfileSlugs(
  profiles: {
    id: string;
    label: string;
    browser: string;
    detail: string;
    blockedReason?: string;
  }[],
): ProfileOption[] {
  const seen = new Set<string>();
  return profiles.map((profile, index) => {
    let slug =
      profile.id === 'clean'
        ? 'clean'
        : profile.label
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    if (slug === '') slug = `profile-${index + 1}`;
    if (seen.has(slug)) slug = `${slug}-${profile.browser.toLowerCase()}`;
    seen.add(slug);
    const option: ProfileOption = {
      slug,
      label: profile.label,
      detail: profile.detail,
    };
    if (profile.blockedReason !== undefined) option.blockedReason = profile.blockedReason;
    return option;
  });
}

export function defaultEndpoint(
  lastEndpoint: string | null,
  endpoints: EndpointOption[],
): string | null {
  const last =
    lastEndpoint === null ? undefined : endpoints.find((item) => item.name === lastEndpoint);
  if (last?.state === 'open') return last.name;

  let best: EndpointOption | undefined;
  for (const item of endpoints) {
    if (item.state !== 'open') continue;
    if (best === undefined) {
      best = item;
      continue;
    }
    const itemAt = item.lastEventAt ?? Number.NEGATIVE_INFINITY;
    const bestAt = best.lastEventAt ?? Number.NEGATIVE_INFINITY;
    if (itemAt > bestAt) best = item;
  }
  return best === undefined ? null : best.name;
}

export function isUrlWord(text: string): boolean {
  return URL_WORD.test(text);
}

export function isUrlAttempt(text: string): boolean {
  return URL_ATTEMPT.test(text);
}

function hostOfBareUrl(text: string): string {
  const withoutScheme = text.replace(EXPLICIT_SCHEME, '');
  const head = withoutScheme.split('/')[0] ?? withoutScheme;
  if (head.startsWith('[')) {
    const close = head.indexOf(']');
    if (close >= 0) return head.slice(0, close + 1).toLowerCase();
  }
  return (head.split(':')[0] ?? head).toLowerCase();
}

function usesHttpScheme(host: string): boolean {
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host === '0.0.0.0' ||
    host === '[::1]' ||
    /^127(?:\.\d{1,3}){3}$/.test(host)
  );
}

export function normalizeUrl(text: string): string {
  if (EXPLICIT_SCHEME.test(text)) return text;
  return `${usesHttpScheme(hostOfBareUrl(text)) ? 'http' : 'https'}://${text}`;
}

export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/** The name a session gets when the tester gives none: the local start time, then the page or endpoint. */
export function defaultSessionName(setup: SessionSetup, at: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return `${day} ${pad(at.getHours())}:${pad(at.getMinutes())} ${sessionPlace(setup)}`;
}

function sessionPlace(setup: SessionSetup): string {
  if (setup.target === 'none') return setup.endpoint === null ? 'no browser' : `#${setup.endpoint}`;
  if (setup.url === '') return 'empty tab';
  try {
    const url = new URL(setup.url);
    return `${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return displayUrl(setup.url);
  }
}

export function copyRecord(record: RecordOptions): RecordOptions {
  return { actions: record.actions, network: record.network, console: record.console };
}

export function copySetup(setup: SessionSetup): SessionSetup {
  return {
    target: setup.target,
    url: setup.url,
    profile: setup.profile,
    record: copyRecord(setup.record),
    endpoint: setup.endpoint,
  };
}
