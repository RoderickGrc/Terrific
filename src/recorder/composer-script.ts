/// <reference lib="dom" />

// This function is serialized and evaluated in the page; keep all helpers local.
export const COMPOSER_BINDING = '__terrificCompose';
export const composerScript: (bindingName: string) => void = function composerScript(bindingName) {
  if (window !== window.top) return;
  const w = window as unknown as Record<string, unknown>;
  if (w.__terrificComposer) return;
  w.__terrificComposer = true;

  function h(tag: string, attrs: Record<string, string> = {}, children: (Node | string)[] = []) {
    const el = document.createElement(tag);
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.append(...children);
    return el;
  }
  function svg(paths: string[], size = 14) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    for (const [key, value] of Object.entries({
      width: `${size}`,
      height: `${size}`,
      viewBox: '0 0 24 24',
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': '2',
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    }))
      el.setAttribute(key, value);
    for (const d of paths) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', d);
      el.append(path);
    }
    return el;
  }
  const icons = {
    msg: ['M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'],
    bug: [
      'm8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1',
      'M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4',
    ],
    cam: [
      'M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z',
      'M15 13a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    ],
    scan: [
      'M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10',
    ],
    ptr: [
      'M4.04 4.69a.5.5 0 0 1 .65-.65l16 6.5a.5.5 0 0 1-.06.95l-6.12 1.58a2 2 0 0 0-1.44 1.44l-1.58 6.12a.5.5 0 0 1-.95.07z',
    ],
    x: ['M18 6 6 18M6 6l12 12'],
    check: ['M20 6 9 17l-5-5'],
  };
  const css = `
:host{all:initial}
*{box-sizing:border-box}
[hidden]{display:none!important}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483646;font:500 13px/1.4 Inter,system-ui,"Segoe UI",sans-serif;color:#e4e4e7;-webkit-font-smoothing:antialiased}
.layer.capturing{visibility:hidden}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
button{font:inherit;cursor:pointer}
button:focus-visible{outline:2px solid rgba(255,255,255,.45);outline-offset:1px}
button:disabled{cursor:default;opacity:.4}
.panel.sent button:disabled{opacity:1}
.panel{position:fixed;pointer-events:auto;width:366px;max-width:calc(100vw - 16px);background:#18181b;border:1px solid rgba(255,255,255,.1);border-radius:16px;box-shadow:0 25px 50px -12px rgba(0,0,0,.5);overflow:hidden;transition:opacity 160ms cubic-bezier(.2,.8,.2,1),transform 160ms cubic-bezier(.2,.8,.2,1)}
.panel.faded{opacity:0;transform:scale(.97)}
@media (prefers-reduced-motion:reduce){.panel{transition:none}}
.hd{display:flex;align-items:center;gap:8px;height:38px;padding:0 6px 0 12px;background:rgba(24,24,27,.8);border-bottom:1px solid rgba(255,255,255,.05);cursor:grab;color:#52525b;user-select:none;touch-action:none}
.hd.dragging{cursor:grabbing}
.hd h2{margin:0;font:700 11px Inter,system-ui,sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#fff}
.ib{margin-left:auto;width:28px;height:28px;display:grid;place-items:center;border:0;border-radius:8px;background:transparent;color:#71717a}
.ib:hover{color:#fff;background:rgba(255,255,255,.05)}
.edwrap{position:relative;background:#09090b}
.edwrap:focus-within{box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.ed{min-height:96px;max-height:240px;overflow:auto;padding:12px 14px;font:400 14px/1.85 Inter,system-ui,sans-serif;color:#f4f4f5;outline:none;white-space:pre-wrap;word-break:break-word;caret-color:#fff}
.ed.empty::before{content:attr(data-placeholder);color:#52525b;position:absolute;pointer-events:none}
.ch{display:inline-flex;align-items:center;gap:4px;height:21px;padding:0 6px;margin:0 1px;vertical-align:1px;border-radius:6px;font:500 12px/1 "JetBrains Mono",Consolas,monospace;white-space:nowrap;user-select:all;cursor:default}
.ch.el{background:rgba(99,102,241,.15);border:1px solid rgba(99,102,241,.1);color:#a5b4fc}
.ch.cap{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);color:#e4e4e7;font-family:Inter,system-ui,sans-serif}
.ch.cap svg{color:#22d3ee}
.ch.gone{opacity:.45;border-style:dashed}
.ch:hover{filter:brightness(1.25)}
.ch .rm{display:none;width:14px;height:14px;margin:0 -2px 0 1px;border:0;padding:0;border-radius:3px;background:transparent;color:inherit;place-items:center}
.ch:hover .rm{display:inline-grid}
.ch .rm:hover{background:rgba(255,255,255,.12)}
.tools{display:flex;align-items:center;gap:2px;padding:6px 8px;background:#18181b;border-top:1px solid rgba(255,255,255,.05)}
.tl{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 8px;border:0;border-radius:8px;background:transparent;color:#a1a1aa;font-size:12px;font-weight:500}
.tl svg{color:#71717a}
.tl:hover:not(:disabled){color:#fff;background:rgba(255,255,255,.05)}
.tl:hover:not(:disabled) svg{color:#fff}
.tl[aria-pressed=true]{background:rgba(99,102,241,.15);color:#a5b4fc}
.tl[aria-pressed=true] svg{color:#a5b4fc}
.ft{display:flex;align-items:center;gap:6px;padding:8px;border-top:1px solid rgba(255,255,255,.05);background:#18181b;min-height:47px}
.idle{display:contents}
.hint{font:400 11px "JetBrains Mono",Consolas,monospace;color:#71717a;padding:0 6px;display:flex;align-items:center;gap:4px}
kbd{font:500 10px "JetBrains Mono",Consolas,monospace;color:#71717a;border:1px solid rgba(255,255,255,.1);border-radius:4px;padding:1px 4px}
.bn{height:30px;padding:0 10px;border-radius:8px;display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:500;border:1px solid transparent}
.bb{margin-left:auto;background:rgba(239,68,68,.1);color:#f87171;border-color:rgba(239,68,68,.2)}
.bb:hover:not(:disabled){background:rgba(239,68,68,.2)}
.bw{background:#fff;color:#000}
.bw:hover:not(:disabled){background:#e4e4e7}
.err{margin:0;padding:8px 14px;font-size:12px;color:#fca5a5;background:rgba(239,68,68,.08);border-top:1px solid rgba(239,68,68,.15)}
.hl,.ref{position:fixed;pointer-events:none;border-radius:4px}
.hl{border:2px solid #a5b4fc;background:rgba(165,180,252,.14)}
.ref{border:2px dashed #a5b4fc}
.tg{position:absolute;left:-2px;bottom:100%;background:#a5b4fc;color:#09090b;font:500 11px/18px "JetBrains Mono",Consolas,monospace;padding:0 6px;border-radius:4px 4px 0 0;white-space:nowrap}
.tg.inside{bottom:auto;top:0;border-radius:0 0 4px 0}
.pop{position:fixed;width:224px;padding:6px;background:#18181b;border:1px solid rgba(255,255,255,.1);border-radius:10px;box-shadow:0 12px 30px rgba(0,0,0,.45)}
.pop .im{position:relative;max-height:160px;border-radius:6px;overflow:hidden;background:#fff}
.pop img{display:block;width:100%;height:auto}
.pop .meta{display:flex;justify-content:space-between;gap:8px;margin:6px 2px 0;font:400 11px Inter,system-ui,sans-serif;color:#a1a1aa}
.pop .meta b{color:#e4e4e7;font-weight:500}
.pop .sn{padding:4px 4px 2px;font:400 12px/1.5 Inter,system-ui,sans-serif;color:#a1a1aa}
.pop .sn b{display:block;color:#e4e4e7;font-weight:500;margin-bottom:2px}
.pop .excerpt{margin-top:4px;color:#71717a}
`;
  const host = document.createElement('terrific-composer');
  // Init scripts can run before <html> exists; the Alt+right-click handler attaches the host on demand.
  if (document.documentElement) document.documentElement.append(host);
  const root = host.attachShadow({ mode: 'open' });
  if (
    'adoptedStyleSheets' in root &&
    typeof CSSStyleSheet !== 'undefined' &&
    'replaceSync' in CSSStyleSheet.prototype
  ) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
    root.adoptedStyleSheets = [sheet];
  } else {
    const style = document.createElement('style');
    style.textContent = css;
    root.append(style);
  }
  const button = (
    cls: string,
    label: string,
    icon: string[],
    attrs: Record<string, string> = {},
  ) => {
    const text = h('span', {}, [label]);
    const el = h('button', { class: cls, type: 'button', ...attrs }, [
      svg(icon),
      text,
    ]) as HTMLButtonElement;
    return { el, text };
  };
  const layer = h('div', { class: 'layer' });
  const ref = h('div', { class: 'ref', hidden: '' });
  const tag = h('span', { class: 'tg' });
  const hl = h('div', { class: 'hl', hidden: '' }, [tag]);
  const panel = h('section', {
    class: 'panel',
    role: 'dialog',
    'aria-modal': 'false',
    'aria-labelledby': 'tc-title',
    hidden: '',
  });
  const grip = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({
    width: '10',
    height: '16',
    viewBox: '0 0 10 16',
    fill: 'currentColor',
    'aria-hidden': 'true',
  }))
    grip.setAttribute(key, value);
  for (const x of [2, 8])
    for (const y of [3, 8, 13]) {
      const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      circle.setAttribute('cx', `${x}`);
      circle.setAttribute('cy', `${y}`);
      circle.setAttribute('r', '1.4');
      grip.append(circle);
    }
  const closeBtn = h(
    'button',
    {
      class: 'ib close',
      type: 'button',
      'aria-label': 'Close',
      title: 'Close (Esc). The draft is kept.',
    },
    [svg(icons.x)],
  );
  const hd = h('div', { class: 'hd' }, [grip, h('h2', { id: 'tc-title' }, ['New note']), closeBtn]);
  const ed = h('div', {
    class: 'ed empty',
    contenteditable: 'true',
    role: 'textbox',
    'aria-multiline': 'true',
    'aria-labelledby': 'tc-title',
    'data-placeholder': 'Describe what happened',
    spellcheck: 'true',
  });
  const point = button('tl', 'Point', icons.ptr, { 'aria-pressed': 'false' });
  const shot = button('tl', 'Screenshot', icons.cam);
  const snap = button('tl', 'Snapshot', icons.scan);
  const err = h('p', { class: 'err', role: 'alert', hidden: '' });
  const bug = button('bn bb', 'Bug', icons.bug, { title: 'Save as bug (Ctrl+Shift+Enter)' });
  const note = button('bn bw', 'Note', icons.msg, { title: 'Save as note (Ctrl+Enter)' });
  const idle = h('div', { class: 'idle' }, [
    h('span', { class: 'hint' }, [h('kbd', {}, ['Ctrl']), h('kbd', {}, ['↵']), ' note']),
    bug.el,
    note.el,
  ]);
  const pointingHint = h('span', { class: 'hint', hidden: '' }, [
    'click to add · ↑↓ level · enter · esc',
  ]);
  panel.append(
    hd,
    h('div', { class: 'edwrap' }, [ed]),
    h('div', { class: 'tools' }, [point.el, shot.el, snap.el]),
    err,
    h('div', { class: 'ft' }, [idle, pointingHint]),
  );
  const pop = h('div', { class: 'pop', hidden: '' });
  // Screen-reader-only confirmation; the visible feedback is the button turning into "Saved".
  const status = h('span', { class: 'sr', role: 'status', 'aria-live': 'polite' });
  layer.append(ref, hl, panel, pop, status);
  root.append(layer);
  type Chip =
    | {
        kind: 'element';
        el: Element | null;
        selector: string;
        name: string;
        tag: string;
        reference: string;
      }
    | {
        kind: 'screenshot';
        label: string;
        file: string;
        width: number;
        height: number;
        preview: string | null;
      }
    | {
        kind: 'snapshot';
        label: string;
        id: string | null;
        title: string;
        wordCount: number;
        excerpt: string;
      };
  type DraftSegment =
    | { type: 'text'; text: string }
    | { type: 'element'; selector: string; name: string; tag: string; reference?: string }
    | { type: 'screenshot'; label: string; file: string; width: number; height: number }
    | {
        type: 'snapshot';
        label: string;
        id: string | null;
        title: string;
        wordCount: number;
        excerpt: string;
      };
  type Draft = {
    open: boolean;
    position: { left: number; top: number } | null;
    moved: boolean;
    segments: DraftSegment[];
  };
  type DraftWithPreviews = Omit<Draft, 'segments'> & {
    segments: (DraftSegment & { preview?: string | null })[];
  };
  const chipData = new WeakMap<Element, Chip>();
  let savedRange: Range | null = null;
  let busy = false;
  let moved = false;
  let dirty = false;
  let restoring = false;
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  // Set between a successful submit and the editor being cleared, so no save can resurrect a sent draft.
  let sealed = false;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  const FADE_MS = 170;
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  const reducedMotion = () =>
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  function animateIn() {
    if (reducedMotion()) return;
    panel.classList.add('faded');
    // Commit the faded state before removing it so the transition runs.
    void panel.offsetWidth;
    panel.classList.remove('faded');
  }
  async function fadeOut() {
    if (panel.hidden || reducedMotion()) return;
    panel.classList.add('faded');
    await wait(FADE_MS);
  }
  function cancelClose() {
    if (closeTimer === undefined) return;
    clearTimeout(closeTimer);
    closeTimer = undefined;
    panel.classList.remove('faded');
  }
  const selection = () =>
    'getSelection' in root && typeof root.getSelection === 'function'
      ? (root.getSelection as () => Selection | null)()
      : document.getSelection();
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const isOurs = (e: Event) => e.composedPath().includes(host);
  const usable = (el: Element | null): el is Element =>
    !!el && el !== document.documentElement && el !== document.body && el !== host;
  // Point reference, ported from terrific-markdown-extension contextTracker.js (Point to section).
  // The page URL is left out because the session already records it as navigation events.
  const visibleText = (el: Element) =>
    // biome-ignore lint/performance/useDomNodeTextContent: references describe the text the tester sees.
    el instanceof HTMLElement ? el.innerText : el.textContent || '';
  const collapse = (value: unknown, max: number) => {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  };
  const inlineCode = (value: string) => `\`${String(value).replace(/`/g, "'")}\``;
  const cssEscape = (value: string) =>
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape(value)
      : String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  const cssEscapeAttr = (value: string) =>
    String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  function composedParent(el: Element): Element | null {
    if (el.parentElement) return el.parentElement;
    const scope = el.getRootNode();
    return scope instanceof ShadowRoot ? scope.host : null;
  }
  function describeElement(el: Element) {
    let label = el.localName;
    const id = el.getAttribute('id');
    if (id) label += `#${id}`;
    else {
      const firstClass = (el.getAttribute('class') || '').trim().split(/\s+/)[0];
      if (firstClass) label += `.${firstClass}`;
    }
    return label.length > 36 ? `${label.slice(0, 35)}…` : label;
  }
  function selectorPart(el: Element) {
    for (const attr of ['data-testid', 'data-test', 'name', 'aria-label', 'role']) {
      const value = el.getAttribute(attr);
      if (value) return `${el.localName}[${attr}="${cssEscapeAttr(value)}"]`;
    }
    const parent = el.parentElement;
    if (!parent) return el.localName;
    const same = Array.from(parent.children).filter((c) => c.localName === el.localName);
    return same.length <= 1 ? el.localName : `${el.localName}:nth-of-type(${same.indexOf(el) + 1})`;
  }
  function selectorInScope(el: Element) {
    const scope = el.getRootNode() as Document | ShadowRoot;
    const unique = (selector: string) => {
      try {
        return scope.querySelectorAll(selector).length === 1;
      } catch {
        return false;
      }
    };
    const parts: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const id = n.getAttribute('id');
      if (id && unique(`#${cssEscape(id)}`)) {
        parts.unshift(`#${cssEscape(id)}`);
        return parts.join(' > ');
      }
      parts.unshift(selectorPart(n));
      const selector = parts.join(' > ');
      if (unique(selector)) return selector;
      if (n === document.documentElement) break;
    }
    return parts.join(' > ');
  }
  // Selector without a depth cap; shadow roots are joined with " >>> ".
  function pointSelector(el: Element) {
    const segments: string[] = [];
    for (let n: Element | null = el; n; ) {
      segments.unshift(selectorInScope(n));
      const scope = n.getRootNode();
      n = scope instanceof ShadowRoot ? scope.host : null;
    }
    return segments.join(' >>> ');
  }
  const LANDMARK_TAGS = new Set([
    'main',
    'nav',
    'header',
    'footer',
    'aside',
    'section',
    'article',
    'form',
    'dialog',
  ]);
  const LANDMARK_ROLES = new Set([
    'main',
    'navigation',
    'banner',
    'contentinfo',
    'complementary',
    'region',
    'article',
    'form',
    'search',
    'dialog',
    'alertdialog',
    'tabpanel',
    'list',
    'table',
    'grid',
  ]);
  function ariaName(el: Element) {
    const label = el.getAttribute('aria-label');
    if (label) return collapse(label, 60);
    const labelledBy = el.getAttribute('aria-labelledby');
    if (labelledBy) {
      const scope = el.getRootNode() as Document | ShadowRoot;
      const text = labelledBy
        .split(/\s+/)
        .map((id) => scope.getElementById?.(id)?.textContent || '')
        .join(' ');
      if (text.trim()) return collapse(text, 60);
    }
    return '';
  }
  function headingText(el: Element) {
    const heading = el.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]');
    return heading ? collapse(heading.textContent, 48) : '';
  }
  function landmarkPath(el: Element) {
    const labels: string[] = [];
    for (
      let n: Element | null = el;
      n && n !== document.body && n !== document.documentElement;
      n = composedParent(n)
    ) {
      const role = n.getAttribute('role') || '';
      if (!LANDMARK_TAGS.has(n.localName) && !LANDMARK_ROLES.has(role)) continue;
      const name = ariaName(n) || (n === el ? '' : headingText(n));
      labels.unshift(name ? `${role || n.localName} "${name}"` : role || n.localName);
    }
    return labels.join(' > ');
  }
  function nearestHeading(el: Element) {
    const inside = headingText(el);
    if (inside) return { text: inside, relation: 'inside' };
    let found: Element | null = null;
    for (const heading of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role="heading"]')) {
      if (heading.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = heading;
    }
    return found ? { text: collapse(found.textContent, 48), relation: 'before' } : null;
  }
  function fixedOrSticky(el: Element) {
    for (let n: Element | null = el; n; n = composedParent(n)) {
      const position = getComputedStyle(n).position;
      if (position === 'fixed' || position === 'sticky') return position;
    }
    return '';
  }
  const POINT_STYLE_PROPS: [string, string[]][] = [
    ['display', ['inline', 'none']],
    ['position', ['static']],
    ['z-index', ['auto']],
    ['overflow', ['visible']],
    ['font-size', []],
    ['font-weight', ['400']],
    ['color', []],
    ['background-color', ['rgba(0, 0, 0, 0)', 'transparent']],
    ['padding', ['0px']],
    ['margin', ['0px']],
    ['border-radius', ['0px']],
  ];
  function pointStyles(el: Element) {
    const style = getComputedStyle(el);
    const entries: string[] = [];
    for (const [prop, skip] of POINT_STYLE_PROPS) {
      const value = style.getPropertyValue(prop).trim();
      if (value && !skip.includes(value)) entries.push(`${prop}: ${value}`);
    }
    return entries.join('; ');
  }
  function describeNeighbor(el: Element | null) {
    if (!el) return '';
    const text = collapse(visibleText(el), 40);
    return text ? `${inlineCode(describeElement(el))} "${text}"` : inlineCode(describeElement(el));
  }
  // Describes where an element is, never what it contains beyond a short locating anchor.
  function pointReference(el: Element) {
    const rect = el.getBoundingClientRect();
    const lines: string[] = [];
    const add = (label: string, value: string | false | null | undefined | 0) => {
      if (value) lines.push(`- ${label}: ${value}`);
    };
    const classes = collapse(el.getAttribute('class'), 160);
    const attrs: string[] = [];
    for (const attr of Array.from(el.attributes)) {
      if (!/^data-/.test(attr.name) || attr.name.startsWith('data-terrific')) continue;
      if (attrs.length >= 6) break;
      attrs.push(`${attr.name}="${collapse(attr.value, 60)}"`);
    }
    const ariaStates = [
      'aria-expanded',
      'aria-selected',
      'aria-checked',
      'aria-pressed',
      'aria-current',
      'aria-disabled',
      'aria-hidden',
    ]
      .map((name) => (el.hasAttribute(name) ? `${name}="${el.getAttribute(name)}"` : ''))
      .filter(Boolean);
    const heading = nearestHeading(el);
    const textAnchor = collapse(visibleText(el), 100);
    const name = ariaName(el);
    const role = el.getAttribute('role');
    const styles = pointStyles(el);
    add('Selector', inlineCode(pointSelector(el)));
    add('Element', inlineCode(`<${el.localName}${el.id ? ` id="${el.id}"` : ''}>`));
    add('Classes', classes && inlineCode(classes));
    add('Data attributes', attrs.length && inlineCode(attrs.join(' ')));
    add('Location', landmarkPath(el));
    add('Heading', heading && `"${heading.text}" (${heading.relation})`);
    add('Role', role && inlineCode(role));
    add('Accessible name', name && `"${name}"`);
    add('ARIA state', ariaStates.length && inlineCode(ariaStates.join(' ')));
    add('Text anchor', textAnchor && `"${textAnchor}"`);
    add('Previous sibling', describeNeighbor(el.previousElementSibling));
    add('Next sibling', describeNeighbor(el.nextElementSibling));
    add('Children', el.children.length ? String(el.children.length) : '');
    add(
      'Box',
      `${Math.round(rect.width)}×${Math.round(rect.height)} at page (${Math.round(rect.left + window.scrollX)}, ${Math.round(rect.top + window.scrollY)}), viewport ${window.innerWidth}×${window.innerHeight}`,
    );
    add('Positioning', fixedOrSticky(el));
    add('Styles', styles && inlineCode(styles));
    add(
      'Shadow DOM',
      el.getRootNode() instanceof ShadowRoot ? 'yes, selector pierces with `>>>`' : '',
    );
    return ['<pointed-section>', ...lines, '</pointed-section>'].join('\n');
  }
  // Minimal reference for element chips restored without one (drafts from before references existed).
  function fallbackReference(selector: string, tag: string) {
    return [
      '<pointed-section>',
      `- Selector: ${inlineCode(selector)}`,
      `- Element: ${inlineCode(`<${tag}>`)}`,
      '</pointed-section>',
    ].join('\n');
  }
  function accessibleName(el: Element) {
    const labelled = 'labels' in el ? (el as HTMLInputElement).labels?.[0] : null;
    const heading = el.querySelector('h1,h2,h3,h4,h5,h6,legend,caption');
    const visible = (node: Element | null) =>
      // biome-ignore lint/performance/useDomNodeTextContent: visible text matches the mock's accessible names.
      node instanceof HTMLElement ? node.innerText : node?.textContent || '';
    const leaf =
      el.childElementCount === 0 && !/^(input|textarea|select)$/.test(el.localName)
        ? visible(el)
        : '';
    return (
      el.getAttribute('aria-label') ||
      visible(labelled || null) ||
      visible(heading) ||
      leaf ||
      ''
    )
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);
  }
  function hasContent() {
    return !!ed.textContent?.trim() || !!ed.querySelector('.ch');
  }
  function update() {
    if (!hasContent()) ed.replaceChildren();
    ed.classList.toggle('empty', !hasContent());
    note.el.disabled = busy || !hasContent();
    bug.el.disabled = busy;
    for (const b of [point.el, shot.el, snap.el]) b.disabled = busy;
  }
  function endRange() {
    const r = document.createRange();
    r.selectNodeContents(ed);
    r.collapse(false);
    return r;
  }
  function placeCaret(r: Range) {
    const s = selection();
    if (!s) return;
    s.removeAllRanges();
    s.addRange(r);
    savedRange = r.cloneRange();
  }
  function rangeInEditor() {
    return savedRange && ed.contains(savedRange.startContainer)
      ? savedRange.cloneRange()
      : endRange();
  }
  function needsLeadingSpace(r: Range) {
    const c = r.startContainer,
      o = r.startOffset;
    if (c.nodeType === Node.TEXT_NODE) return o > 0 && !/\s/.test((c as Text).data.charAt(o - 1));
    const prev = c.childNodes[o - 1];
    if (!prev) return false;
    return prev.nodeType === Node.TEXT_NODE
      ? !/\s$/.test((prev as Text).data)
      : prev.nodeName !== 'BR';
  }
  function resolveElement(selector: string): Element | null {
    try {
      const parts = selector.split(' >>> ');
      let scope: Document | ShadowRoot = document;
      let found: Element | null = null;
      for (let i = 0; i < parts.length; i++) {
        found = scope.querySelector(parts[i] ?? '');
        if (!found) return null;
        if (i < parts.length - 1) {
          if (!found.shadowRoot) return null;
          scope = found.shadowRoot;
        }
      }
      if (!found || found === host || host.contains(found)) return null;
      return found;
    } catch {
      return null;
    }
  }
  function decorateElementChip(chip: HTMLElement, data: Extract<Chip, { kind: 'element' }>) {
    data.el = resolveElement(data.selector);
    if (data.el) {
      chip.classList.remove('gone');
      chip.title = data.selector;
    } else {
      chip.classList.add('gone');
      chip.title = `${data.selector} (not on this page)`;
    }
  }
  function insertChip(chip: HTMLElement) {
    ed.focus({ preventScroll: true });
    const r = rangeInEditor();
    // Insert after any selected text instead of replacing it.
    r.collapse(false);
    const after = document.createTextNode(' '),
      frag = document.createDocumentFragment();
    if (needsLeadingSpace(r)) frag.append(' ');
    frag.append(chip, after);
    r.insertNode(frag);
    const caret = document.createRange();
    caret.setStartAfter(after);
    caret.collapse(true);
    placeCaret(caret);
    update();
    dirty = true;
    saveDraftNow();
  }
  function makeChip(data: Chip, label: string, icon?: string[]) {
    const chip = h('span', {
      class: `ch ${data.kind === 'element' ? 'el' : 'cap'}`,
      contenteditable: 'false',
    });
    if (icon) chip.append(svg(icon, 12));
    chip.append(
      h('span', {}, [label]),
      h('button', { class: 'rm', type: 'button', tabindex: '-1', 'aria-label': 'Remove' }, [
        svg(icons.x, 10),
      ]),
    );
    chipData.set(chip, data);
    if (data.kind === 'element') decorateElementChip(chip, data);
    return chip;
  }
  function addElement(el: Element | null) {
    if (!usable(el)) return;
    const chip = makeChip(
      {
        kind: 'element',
        el,
        selector: pointSelector(el),
        name: accessibleName(el),
        tag: el.localName,
        // Captured at pick time so the box and styles describe what the tester saw.
        reference: pointReference(el),
      },
      `<${el.localName}>`,
    );
    insertChip(chip);
  }
  document.addEventListener('selectionchange', () => {
    const s = selection();
    if (s?.rangeCount && ed.contains(s.getRangeAt(0).startContainer))
      savedRange = s.getRangeAt(0).cloneRange();
  });
  ed.addEventListener('input', () => {
    hideError();
    update();
    dirty = true;
    scheduleSave();
  });
  // Copy and cut put two formats on the clipboard: the text form (pointed-section, @ss_, @snapshot:)
  // for pasting anywhere, and the full segments so pasting back into a panel restores identical chips.
  function copySelection(e: ClipboardEvent, cut: boolean) {
    const s = selection();
    if (!s?.rangeCount || !e.clipboardData) return;
    const range = s.getRangeAt(0);
    if (range.collapsed || !ed.contains(range.commonAncestorContainer)) return;
    const segments = buildSegments(range);
    e.preventDefault();
    e.clipboardData.setData('text/plain', serializeSegments(segments));
    e.clipboardData.setData(SEGMENTS_MIME, JSON.stringify(segments));
    if (cut) document.execCommand('delete');
  }
  ed.addEventListener('copy', (e) => copySelection(e, false));
  ed.addEventListener('cut', (e) => copySelection(e, true));
  ed.addEventListener('paste', (e) => {
    e.preventDefault();
    const data = e.clipboardData;
    if (!data) return;
    let segments: DraftSegment[] | null = null;
    const rich = data.getData(SEGMENTS_MIME);
    if (rich) {
      try {
        segments = cleanSegments(JSON.parse(rich));
      } catch {
        segments = null;
      }
    }
    const text = data.getData('text/plain') || '';
    segments ??= parseTokens(text);
    if (segments.every((s) => s.type === 'text')) {
      // Plain text keeps the browser's own insertion, including undo.
      document.execCommand('insertText', false, text);
      return;
    }
    insertSegments(segments);
  });
  ed.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertLineBreak');
    }
  });
  ed.addEventListener('click', (e) => {
    const rm = (e.target as Element).closest('.rm');
    if (!rm) return;
    rm.closest('.ch')?.remove();
    hidePreview();
    update();
    ed.focus();
    dirty = true;
    saveDraftNow();
  });
  let pointing = false,
    chain: Element[] = [],
    level = 0;
  const cursorStyle = document.createElement('style');
  cursorStyle.textContent =
    'html.terrific-pointing, html.terrific-pointing *{cursor:crosshair!important}';
  function drawHighlight() {
    const el = chain[level];
    if (!el) {
      hl.hidden = true;
      return;
    }
    const r = el.getBoundingClientRect();
    Object.assign(hl.style, {
      left: `${r.left - 2}px`,
      top: `${r.top - 2}px`,
      width: `${r.width + 4}px`,
      height: `${r.height + 4}px`,
    });
    tag.textContent =
      el.localName +
      (el.id
        ? `#${el.id}`
        : typeof el.className === 'string' && el.className.trim()
          ? `.${el.className.trim().split(/\s+/)[0]}`
          : '');
    tag.classList.toggle('inside', r.top < 22);
    hl.hidden = false;
  }
  function startPoint() {
    if (pointing) return;
    pointing = true;
    point.el.setAttribute('aria-pressed', 'true');
    idle.hidden = true;
    pointingHint.hidden = false;
    (document.head || document.documentElement).append(cursorStyle);
    document.documentElement.classList.add('terrific-pointing');
    for (const [type, fn] of pointerHandlers) window.addEventListener(type, fn, true);
  }
  function stopPoint() {
    if (!pointing) return;
    pointing = false;
    point.el.setAttribute('aria-pressed', 'false');
    idle.hidden = false;
    pointingHint.hidden = true;
    hl.hidden = true;
    chain = [];
    level = 0;
    document.documentElement.classList.remove('terrific-pointing');
    cursorStyle.remove();
    for (const [type, fn] of pointerHandlers) window.removeEventListener(type, fn, true);
  }
  const block = (e: Event) => {
    if (isOurs(e)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  };
  function firstTarget(e: Event): Element | null {
    const t = e.composedPath()[0];
    return t instanceof Element ? t : t instanceof Node ? t.parentElement : null;
  }
  function pick(el: Element | null) {
    stopPoint();
    addElement(el);
  }
  const pointerHandlers: [string, EventListener][] = [
    [
      'pointermove',
      (e) => {
        if (isOurs(e)) {
          hl.hidden = true;
          chain = [];
          return;
        }
        const el = firstTarget(e);
        if (chain[0] === el) return;
        chain = [];
        for (let n = el; usable(n); n = n.parentElement) chain.push(n);
        level = 0;
        drawHighlight();
      },
    ],
    ['pointerdown', block],
    ['mousedown', block],
    ['mouseup', block],
    ['pointerup', block],
    [
      'click',
      (e) => {
        if (isOurs(e)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        pick(chain[level] || firstTarget(e));
      },
    ],
    [
      'keydown',
      (e) => {
        const key = (e as KeyboardEvent).key;
        if (key === 'Escape') {
          e.preventDefault();
          e.stopImmediatePropagation();
          stopPoint();
          ed.focus();
          return;
        }
        if (!chain.length) return;
        if (key === 'ArrowUp' || key === 'ArrowDown') {
          e.preventDefault();
          e.stopImmediatePropagation();
          level = clamp(level + (key === 'ArrowUp' ? 1 : -1), 0, chain.length - 1);
          drawHighlight();
        } else if (key === 'Enter') {
          e.preventDefault();
          e.stopImmediatePropagation();
          pick(chain[level] || null);
        }
      },
    ],
    ['scroll', () => drawHighlight()],
  ];
  point.el.addEventListener('click', () => {
    if (pointing) {
      stopPoint();
      ed.focus();
    } else startPoint();
  });
  function keepInView() {
    if (panel.hidden) return;
    const r = panel.getBoundingClientRect();
    panel.style.left = `${clamp(r.left, 8, Math.max(8, innerWidth - r.width - 8))}px`;
    panel.style.top = `${clamp(r.top, 8, Math.max(8, innerHeight - r.height - 8))}px`;
  }
  window.addEventListener('resize', keepInView);
  hd.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || (e.target as Element).closest('button')) return;
    const r = panel.getBoundingClientRect(),
      dx = e.clientX - r.left,
      dy = e.clientY - r.top;
    hd.setPointerCapture(e.pointerId);
    hd.classList.add('dragging');
    const move = (ev: PointerEvent) => {
      panel.style.left = `${clamp(ev.clientX - dx, 8, Math.max(8, innerWidth - r.width - 8))}px`;
      panel.style.top = `${clamp(ev.clientY - dy, 8, Math.max(8, innerHeight - r.height - 8))}px`;
    };
    const up = () => {
      hd.classList.remove('dragging');
      moved = true;
      hd.removeEventListener('pointermove', move);
      hd.removeEventListener('pointerup', up);
      hd.removeEventListener('pointercancel', up);
      saveDraftNow();
    };
    hd.addEventListener('pointermove', move);
    hd.addEventListener('pointerup', up);
    hd.addEventListener('pointercancel', up);
  });
  function hidePreview() {
    ref.hidden = true;
    pop.hidden = true;
    pop.replaceChildren();
  }
  ed.addEventListener('mouseover', (e) => {
    const chip = (e.target as Element).closest('.ch');
    if (!chip) return;
    const data = chipData.get(chip);
    if (!data) return;
    if (data.kind === 'element') {
      if (!data.el?.isConnected) return;
      const r = data.el.getBoundingClientRect();
      Object.assign(ref.style, {
        left: `${r.left - 3}px`,
        top: `${r.top - 3}px`,
        width: `${r.width + 6}px`,
        height: `${r.height + 6}px`,
      });
      ref.hidden = false;
      return;
    }
    pop.replaceChildren();
    if (data.kind === 'screenshot') {
      if (data.preview) {
        const img = h('img', { src: data.preview, alt: '' }) as HTMLImageElement;
        const container = h('div', { class: 'im' }, [img]);
        img.addEventListener('error', () => container.remove());
        pop.append(container);
      }
      const fileName = data.file.replace(/^screenshots\//, '');
      pop.append(
        h('div', { class: 'meta' }, [
          h('b', {}, [data.label]),
          // Pasted chips only know the file, not the capture size.
          h('span', {}, [data.width > 0 ? `${data.width}×${data.height}` : fileName]),
        ]),
      );
    } else if (data.title) {
      pop.append(
        h('div', { class: 'sn' }, [
          h('b', {}, [`${data.label} · page scrape`]),
          h('span', {}, [`${data.title} · ${data.wordCount} words`]),
          h('div', { class: 'excerpt' }, [`${data.excerpt}…`]),
        ]),
      );
    } else {
      pop.append(
        h('div', { class: 'sn' }, [
          h('b', {}, [`${data.label} · page scrape`]),
          h('span', {}, [data.id ?? '']),
        ]),
      );
    }
    pop.hidden = false;
    const cr = chip.getBoundingClientRect(),
      pr = pop.getBoundingClientRect();
    pop.style.left = `${clamp(cr.left + cr.width / 2 - pr.width / 2, 8, innerWidth - pr.width - 8)}px`;
    pop.style.top = `${cr.top - pr.height - 8 >= 8 ? cr.top - pr.height - 8 : cr.bottom + 8}px`;
  });
  ed.addEventListener('mouseout', (e) => {
    const chip = (e.target as Element).closest('.ch');
    if (chip && !(e.relatedTarget instanceof Node && chip.contains(e.relatedTarget))) hidePreview();
  });
  async function bridge<T>(op: string, payload?: unknown): Promise<T> {
    const fn = w[bindingName];
    if (typeof fn !== 'function') throw new Error('Terrific is not connected to this page.');
    return payload === undefined ? fn(op) : fn(op, payload);
  }
  const frame = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  async function capture(kind: 'screenshot' | 'snapshot') {
    if (busy) return;
    stopPoint();
    hideError();
    hidePreview();
    const btn = kind === 'screenshot' ? shot : snap,
      buttonLabel = btn.text.textContent;
    busy = true;
    update();
    btn.text.textContent = kind === 'screenshot' ? 'Capturing…' : 'Reading page…';
    try {
      let chip: HTMLElement;
      if (kind === 'screenshot') {
        let res: {
          file: string;
          width: number;
          height: number;
          preview: string | null;
          label: string;
        };
        try {
          // Fade out, then hide outright so a half-transparent panel never lands in the image.
          await fadeOut();
          layer.classList.add('capturing');
          await frame();
          res = await bridge('screenshot');
        } finally {
          layer.classList.remove('capturing');
          panel.classList.remove('faded');
        }
        chip = makeChip(
          {
            kind: 'screenshot',
            label: res.label,
            file: res.file,
            width: res.width,
            height: res.height,
            preview: res.preview,
          },
          res.label,
          icons.cam,
        );
      } else {
        const res = await bridge<{
          id: string | null;
          title: string;
          wordCount: number;
          excerpt: string;
          label: string;
        }>('snapshot');
        chip = makeChip(
          {
            kind: 'snapshot',
            label: res.label,
            id: res.id,
            title: res.title,
            wordCount: res.wordCount,
            excerpt: res.excerpt,
          },
          res.label,
          icons.scan,
        );
      }
      busy = false;
      insertChip(chip);
    } catch (error) {
      showError(
        `${kind === 'screenshot' ? 'Screenshot' : 'Snapshot'} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      busy = false;
      btn.text.textContent = buttonLabel;
      update();
    }
  }
  shot.el.addEventListener('click', () => {
    void capture('screenshot');
  });
  snap.el.addEventListener('click', () => {
    void capture('snapshot');
  });
  // Text form of a draft, used for the stored note and for the clipboard:
  // elements as a <pointed-section> block, screenshots as @ss_<id>.png, snapshots as @snapshot:<event id>.
  function segmentText(segment: DraftSegment): string {
    if (segment.type === 'text') return segment.text;
    if (segment.type === 'element') {
      return segment.reference || fallbackReference(segment.selector, segment.tag);
    }
    if (segment.type === 'screenshot') return `@${segment.file.replace(/^screenshots\//, '')}`;
    return segment.id ? `@snapshot:${segment.id}` : '@snapshot';
  }
  // Element blocks sit on their own lines; a line break is added only where the text lacks one.
  function serializeSegments(segments: DraftSegment[]): string {
    let out = '';
    let afterBlock = false;
    for (const segment of segments) {
      let piece = segmentText(segment);
      if (segment.type === 'element') {
        out = out.replace(/[ \t]+$/, '');
        if (out && !out.endsWith('\n')) out += '\n';
        out += piece;
        afterBlock = true;
        continue;
      }
      if (afterBlock) {
        piece = piece.replace(/^[ \t]+/, '');
        if (!piece) continue;
        if (!piece.startsWith('\n')) piece = `\n${piece}`;
        afterBlock = false;
      }
      out += piece;
    }
    return out.replace(/[ \t]+\n/g, '\n').trim();
  }
  const SEGMENTS_MIME = 'application/x-terrific-segments+json';
  const TOKEN_RE =
    /(?:<page-reference\b[^>]*>\s*)?<pointed-section>([\s\S]*?)<\/pointed-section>(?:\s*<\/page-reference>)?|@ss_[A-Za-z0-9_-]+\.png|@snapshot:ev_[A-Za-z0-9_-]+/g;
  // Turns one pasted token into a chip segment; anything malformed stays plain text.
  function tokenSegment(token: string, body: string | undefined): DraftSegment | null {
    if (body !== undefined) {
      const selector = /^- Selector: `([^`]+)`/m.exec(body)?.[1];
      const tag = /^- Element: `<([a-z][a-z0-9-]*)/m.exec(body)?.[1];
      const reference = `<pointed-section>${body}</pointed-section>`;
      if (!selector || !tag || selector.length > 2000 || reference.length > 8000) return null;
      const name =
        /^- Accessible name: "(.*)"$/m.exec(body)?.[1] ||
        /^- Heading: "(.*)" \(/m.exec(body)?.[1] ||
        '';
      return { type: 'element', selector, tag, name: name.slice(0, 40), reference };
    }
    if (token.startsWith('@ss_')) {
      return {
        type: 'screenshot',
        label: 'Screenshot',
        file: `screenshots/${token.slice(1)}`,
        width: 0,
        height: 0,
      };
    }
    const id = token.slice('@snapshot:'.length);
    return { type: 'snapshot', label: 'Snapshot', id, title: '', wordCount: 0, excerpt: '' };
  }
  function parseTokens(text: string): DraftSegment[] {
    const segments: DraftSegment[] = [];
    let last = 0;
    for (const match of text.matchAll(TOKEN_RE)) {
      const segment = tokenSegment(match[0], match[1]);
      if (!segment) continue;
      const index = match.index ?? 0;
      if (index > last) segments.push({ type: 'text', text: text.slice(last, index) });
      segments.push(segment);
      last = index + match[0].length;
    }
    if (last < text.length) segments.push({ type: 'text', text: text.slice(last) });
    return segments;
  }
  // Re-validates segments read from the clipboard; returns null if anything does not fit the draft model.
  function cleanSegments(value: unknown): DraftSegment[] | null {
    if (!Array.isArray(value) || value.length > 200) return null;
    const str = (v: unknown, max = 2000) => typeof v === 'string' && v.length <= max;
    const num = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
    const out: DraftSegment[] = [];
    for (const s of value) {
      if (!s || typeof s !== 'object') return null;
      const v = s as Record<string, unknown>;
      if (v.type === 'text' && str(v.text, 20000))
        out.push({ type: 'text', text: v.text as string });
      else if (
        v.type === 'element' &&
        str(v.selector) &&
        str(v.name) &&
        typeof v.tag === 'string' &&
        /^[a-z][a-z0-9-]*$/.test(v.tag) &&
        (v.reference === undefined || str(v.reference, 8000))
      )
        out.push({
          type: 'element',
          selector: v.selector as string,
          name: v.name as string,
          tag: v.tag,
          reference: v.reference as string | undefined,
        });
      else if (
        v.type === 'screenshot' &&
        str(v.label) &&
        typeof v.file === 'string' &&
        /^screenshots\/ss_[A-Za-z0-9_-]+\.png$/.test(v.file) &&
        num(v.width) &&
        num(v.height)
      )
        out.push({
          type: 'screenshot',
          label: v.label as string,
          file: v.file,
          width: v.width as number,
          height: v.height as number,
        });
      else if (
        v.type === 'snapshot' &&
        str(v.label) &&
        (v.id === null || str(v.id)) &&
        str(v.title) &&
        num(v.wordCount) &&
        str(v.excerpt)
      )
        out.push({
          type: 'snapshot',
          label: v.label as string,
          id: v.id as string | null,
          title: v.title as string,
          wordCount: v.wordCount as number,
          excerpt: v.excerpt as string,
        });
      else return null;
    }
    return out;
  }
  function showError(msg: string) {
    err.textContent = msg;
    err.hidden = false;
  }
  function hideError() {
    err.hidden = true;
  }
  function currentPosition(): { left: number; top: number } | null {
    const left = panel.style.left;
    const top = panel.style.top;
    if (!left || !top) return null;
    const leftN = Number.parseFloat(left);
    const topN = Number.parseFloat(top);
    if (!Number.isFinite(leftN) || !Number.isFinite(topN)) return null;
    return { left: leftN, top: topN };
  }
  // Segments of the whole editor, or only of the part inside `range` (for copy and cut).
  function buildSegments(range?: Range): DraftSegment[] {
    const segments: DraftSegment[] = [];
    let text = '';
    const flush = () => {
      if (text === '') return;
      segments.push({ type: 'text', text });
      text = '';
    };
    const outside = (n: Node) => range !== undefined && !range.intersectsNode(n);
    const walk = (node: Node) => {
      for (const n of node.childNodes) {
        if (outside(n)) continue;
        if (n.nodeType === Node.TEXT_NODE) {
          let data = (n as Text).data;
          if (range) {
            const end = n === range.endContainer ? range.endOffset : data.length;
            data = data.slice(n === range.startContainer ? range.startOffset : 0, end);
          }
          text += data;
          continue;
        }
        if (n.nodeName === 'BR') {
          text += '\n';
          continue;
        }
        if (n instanceof Element && n.classList.contains('ch')) {
          flush();
          const d = chipData.get(n);
          if (!d) continue;
          if (d.kind === 'element') {
            segments.push({
              type: 'element',
              selector: d.selector,
              name: d.name,
              tag: d.tag,
              reference: d.reference,
            });
          } else if (d.kind === 'screenshot') {
            segments.push({
              type: 'screenshot',
              label: d.label,
              file: d.file,
              width: d.width,
              height: d.height,
            });
          } else {
            segments.push({
              type: 'snapshot',
              label: d.label,
              id: d.id,
              title: d.title,
              wordCount: d.wordCount,
              excerpt: d.excerpt,
            });
          }
          continue;
        }
        if (n instanceof Element) {
          if (n.nodeName === 'DIV' && text && !text.endsWith('\n')) text += '\n';
          walk(n);
        }
      }
    };
    walk(ed);
    flush();
    return segments;
  }
  function buildDraft(): Draft {
    return {
      open: !panel.hidden,
      position: currentPosition(),
      moved,
      segments: buildSegments(),
    };
  }
  function cancelPendingSave() {
    if (saveTimer === undefined) return;
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  function saveDraftNow() {
    if (restoring || sealed) return;
    cancelPendingSave();
    void bridge('saveDraft', buildDraft()).catch(() => {});
  }
  function scheduleSave() {
    if (restoring || sealed) return;
    cancelPendingSave();
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      saveDraftNow();
    }, 300);
  }
  function placeDefault() {
    const r = panel.getBoundingClientRect();
    panel.style.left = `${clamp(innerWidth - r.width - 20, 8, Math.max(8, innerWidth - r.width - 8))}px`;
    panel.style.top = `${clamp(innerHeight - r.height - 20, 8, Math.max(8, innerHeight - r.height - 8))}px`;
  }
  function placeAt(position: { left: number; top: number } | null) {
    if (position) {
      panel.style.left = `${position.left}px`;
      panel.style.top = `${position.top}px`;
    } else {
      placeDefault();
    }
    keepInView();
  }
  // DOM nodes for one segment. Spacing lives in the text segments, so nothing is added around chips.
  function segmentNodes(segment: DraftSegment & { preview?: string | null }): Node[] {
    if (segment.type === 'text') {
      const nodes: Node[] = [];
      segment.text.split('\n').forEach((part, i) => {
        if (i > 0) nodes.push(document.createElement('br'));
        if (part) nodes.push(document.createTextNode(part));
      });
      return nodes;
    }
    if (segment.type === 'element') {
      return [
        makeChip(
          {
            kind: 'element',
            el: null,
            selector: segment.selector,
            name: segment.name,
            tag: segment.tag,
            reference: segment.reference || fallbackReference(segment.selector, segment.tag),
          },
          `<${segment.tag}>`,
        ),
      ];
    }
    if (segment.type === 'screenshot') {
      return [
        makeChip(
          {
            kind: 'screenshot',
            label: segment.label,
            file: segment.file,
            width: segment.width,
            height: segment.height,
            preview: segment.preview ?? null,
          },
          segment.label,
          icons.cam,
        ),
      ];
    }
    return [
      makeChip(
        {
          kind: 'snapshot',
          label: segment.label,
          id: segment.id,
          title: segment.title,
          wordCount: segment.wordCount,
          excerpt: segment.excerpt,
        },
        segment.label,
        icons.scan,
      ),
    ];
  }
  function applyDraft(draft: DraftWithPreviews) {
    ed.replaceChildren(...draft.segments.flatMap(segmentNodes));
    savedRange = null;
    moved = draft.moved;
    update();
  }
  // Pasted segments replace the selection, like any paste.
  function insertSegments(segments: DraftSegment[]) {
    ed.focus({ preventScroll: true });
    const r = rangeInEditor();
    r.deleteContents();
    const nodes = segments.flatMap(segmentNodes);
    const lastNode = nodes[nodes.length - 1];
    if (!lastNode) return;
    const frag = document.createDocumentFragment();
    frag.append(...nodes);
    r.insertNode(frag);
    const caret = document.createRange();
    caret.setStartAfter(lastNode);
    caret.collapse(true);
    placeCaret(caret);
    hideError();
    update();
    dirty = true;
    saveDraftNow();
  }
  async function loadAndApplyDraft(): Promise<DraftWithPreviews | null> {
    if (dirty) return null;
    const fn = w[bindingName];
    if (typeof fn !== 'function') return null;
    restoring = true;
    try {
      const result = (await bridge('loadDraft')) as { draft: DraftWithPreviews | null };
      if (dirty || !result.draft) return result.draft;
      applyDraft(result.draft);
      return result.draft;
    } catch {
      return null;
    } finally {
      restoring = false;
    }
  }
  function showPanelFromDraft(draft: DraftWithPreviews) {
    if (!host.isConnected) document.documentElement.append(host);
    stopPoint();
    panel.hidden = false;
    placeAt(draft.position);
    animateIn();
  }
  function close() {
    stopPoint();
    hidePreview();
    hideError();
    if (panel.hidden || closeTimer !== undefined) return;
    const finish = () => {
      closeTimer = undefined;
      panel.hidden = true;
      panel.classList.remove('faded');
      saveDraftNow();
    };
    if (reducedMotion()) {
      finish();
      return;
    }
    panel.classList.add('faded');
    closeTimer = setTimeout(finish, FADE_MS);
  }
  async function send(kind: 'note' | 'bug') {
    if (busy || (kind === 'note' && !hasContent())) return;
    stopPoint();
    hideError();
    hidePreview();
    cancelPendingSave();
    const btn = kind === 'bug' ? bug : note;
    const text = serializeSegments(buildSegments());
    busy = true;
    update();
    btn.text.textContent = 'Saving…';
    const icon = btn.el.firstElementChild;
    const label = kind === 'bug' ? 'Bug' : 'Note';
    try {
      await bridge('submit', { kind, text: text || null });
      // The session already cleared its copy; keep the sent text on screen only for the confirmation.
      sealed = true;
      dirty = false;
      panel.classList.add('sent');
      btn.text.textContent = 'Saved';
      icon?.replaceWith(svg(icons.check));
      status.textContent = `${label} saved`;
      await wait(reducedMotion() ? 300 : 450);
      close();
      await wait(reducedMotion() ? 0 : FADE_MS + 10);
      ed.replaceChildren();
      savedRange = null;
      sealed = false;
      saveDraftNow();
    } catch (error) {
      showError(
        `Not saved: ${error instanceof Error ? error.message : String(error)} Your draft is kept.`,
      );
    } finally {
      sealed = false;
      busy = false;
      panel.classList.remove('sent');
      btn.text.textContent = label;
      const current = btn.el.firstElementChild;
      if (icon && current !== icon) current?.replaceWith(icon);
      update();
    }
  }
  bug.el.addEventListener('click', () => {
    void send('bug');
  });
  note.el.addEventListener('click', () => {
    void send('note');
  });
  closeBtn.addEventListener('click', close);
  panel.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      void send(e.shiftKey ? 'bug' : 'note');
    } else if (e.key === 'Escape' && !pointing) {
      e.preventDefault();
      close();
    }
  });
  function flushSave() {
    if (restoring || sealed) return;
    cancelPendingSave();
    const fn = w[bindingName];
    if (typeof fn !== 'function') return;
    void bridge('saveDraft', buildDraft()).catch(() => {});
  }
  window.addEventListener('pagehide', flushSave);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSave();
  });
  update();
  const boot = (async () => {
    const ready =
      document.readyState !== 'loading'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
          });
    await ready;
    const draft = await loadAndApplyDraft();
    if (!draft?.open) return;
    showPanelFromDraft(draft);
  })();
  window.addEventListener(
    'contextmenu',
    (e) => {
      if (!e.altKey || isOurs(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      void (async () => {
        await boot;
        if (!host.isConnected) document.documentElement.append(host);
        if (pointing) stopPoint();
        cancelClose();
        const wasOpen = !panel.hidden;
        if (!wasOpen) {
          const draft = await loadAndApplyDraft();
          panel.hidden = false;
          if (!moved) {
            const r = panel.getBoundingClientRect();
            panel.style.left = `${clamp(e.clientX + 12, 8, Math.max(8, innerWidth - r.width - 8))}px`;
            panel.style.top = `${e.clientY + 12 + r.height <= innerHeight - 8 ? e.clientY + 12 : clamp(e.clientY - r.height - 12, 8, Math.max(8, innerHeight - r.height - 8))}px`;
          } else if (draft?.position) {
            placeAt(draft.position);
          }
          keepInView();
          animateIn();
          saveDraftNow();
        }
        ed.focus({ preventScroll: true });
        placeCaret(rangeInEditor());
      })();
    },
    true,
  );
};

export function composerScriptSource(bindingName: string): string {
  return `(${composerScript.toString()})(${JSON.stringify(bindingName)})`;
}
