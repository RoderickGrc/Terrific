/// <reference lib="dom" />

// Serialized via Function.prototype.toString(). Type annotations, casts, and
// aliases are erased before the function exists (Node type stripping in
// development, tsdown in the published build), so toString() is always plain
// JavaScript. The body must not close over module scope: it runs in the page.
export const BINDING_NAME = '__terrificRecord';

export const pageScript: (bindingName: string) => void = function pageScript(bindingName) {
  const flag = '__terrificPageScript';
  // Only the install flag and the binding are read by name, so a plain record is enough.
  const w = window as unknown as Record<string, unknown>;
  if (w[flag]) return;
  w[flag] = true;

  const INPUT_GAP_MS = 300;

  // Local copy of the binding payload; this function cannot import module types.
  type ActionName = 'click' | 'input' | 'change' | 'select' | 'submit' | 'keydown';
  type ActionTarget = {
    label?: string;
    selector?: string;
    xpath?: string;
  };
  type ActionPayload = {
    action: ActionName;
    target: ActionTarget;
    masked: boolean;
    value?: string;
    valueLength?: number;
  };
  type Extra = {
    value?: string;
    valueLength?: number;
    masked?: boolean;
  };
  type Pending = {
    extra: Extra;
    timer: ReturnType<typeof setTimeout> | null;
  };

  const pending = new WeakMap<Element, Pending>();

  function trimText(value: unknown, max?: number) {
    const text = String(value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (max && text.length > max) return text.slice(0, max);
    return text;
  }

  function visibleText(el: Element): string {
    if (!(el instanceof HTMLElement)) return el.textContent ?? '';
    // biome-ignore lint/performance/useDomNodeTextContent: labels must be the text the tester sees; textContent includes hidden text.
    return el.innerText || el.textContent || '';
  }

  function hasLabels(
    el: Element,
  ): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement {
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLButtonElement
    );
  }

  function associatedLabel(el: Element) {
    const firstLabel = hasLabels(el) ? el.labels?.[0] : undefined;
    if (firstLabel) return trimText(visibleText(firstLabel), 80);
    if (el.id) {
      const byFor = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (byFor) return trimText(visibleText(byFor), 80);
    }
    const wrap = el.closest('label');
    if (wrap) return trimText(visibleText(wrap), 80);
    return '';
  }

  function fieldName(el: Element) {
    if (
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement ||
      el instanceof HTMLButtonElement
    ) {
      return el.name;
    }
    return '';
  }

  function fieldPlaceholder(el: Element) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.placeholder;
    return '';
  }

  function labelOf(el: Element) {
    const aria = el.getAttribute('aria-label');
    if (aria && trimText(aria, 80)) return trimText(aria, 80);
    const associated = associatedLabel(el);
    if (associated) return associated;
    const placeholder = fieldPlaceholder(el);
    if (placeholder && trimText(placeholder, 80)) return trimText(placeholder, 80);
    const name = fieldName(el);
    if (name && trimText(name, 80)) return trimText(name, 80);
    const visible = visibleText(el);
    const inner = trimText(visible, 80);
    if (inner) return inner;
    if (el.id) return el.id;
    return '';
  }

  function cssPath(el: Element) {
    const parts: string[] = [];
    let current: Element | null = el;
    while (current?.nodeType === 1 && parts.length < 4) {
      const tag = current.tagName.toLowerCase();
      let nth = 1;
      let sib: Element | null = current.previousElementSibling;
      while (sib) {
        if (sib.tagName === current.tagName) nth += 1;
        sib = sib.previousElementSibling;
      }
      parts.unshift(`${tag}:nth-of-type(${nth})`);
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function selectorOf(el: Element) {
    if (el.id && document.querySelectorAll(`#${CSS.escape(el.id)}`).length === 1) {
      return `#${CSS.escape(el.id)}`;
    }
    const testId = el.getAttribute('data-testid');
    if (testId) return `[data-testid=${JSON.stringify(testId)}]`;
    return cssPath(el);
  }

  function xpathOf(el: Element) {
    if (el.id) return `//*[@id=${JSON.stringify(el.id)}]`;
    const parts: string[] = [];
    let current: Element | null = el;
    while (current?.nodeType === 1) {
      const tag = current.tagName.toLowerCase();
      let index = 1;
      let sib: ChildNode | null = current.previousSibling;
      while (sib) {
        if (sib.nodeType === 1 && sib.nodeName === current.nodeName) index += 1;
        sib = sib.previousSibling;
      }
      parts.unshift(index > 1 ? `${tag}[${index}]` : tag);
      current = current.parentElement;
    }
    return parts.length ? `/${parts.join('/')}` : '';
  }

  function isPassword(el: EventTarget | null) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (String(el.type || '').toLowerCase() === 'password') return true;
    const auto = String(el.getAttribute('autocomplete') || '').toLowerCase();
    if (auto.indexOf('password') !== -1) return true;
    const key = `${String(el.name || '')} ${String(el.id || '')}`;
    return /pass|pwd|secret|token/i.test(key);
  }

  function targetOf(el: Element): ActionTarget {
    return { label: labelOf(el), selector: selectorOf(el), xpath: xpathOf(el) };
  }

  function send(payload: ActionPayload) {
    const fn = w[bindingName];
    if (typeof fn === 'function') (fn as (next: ActionPayload) => void)(payload);
  }

  function emit(action: ActionName, el: Element, extra: Extra | null) {
    const payload: ActionPayload = { action, target: targetOf(el), masked: false };
    if (extra) {
      if (extra.value !== undefined) payload.value = extra.value;
      if (extra.valueLength !== undefined) payload.valueLength = extra.valueLength;
      if (extra.masked) payload.masked = true;
    }
    send(payload);
  }

  function flushInput(el: Element) {
    const state = pending.get(el);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    pending.delete(el);
    emit('input', el, state.extra);
  }

  function queueInput(el: Element, extra: Extra) {
    let state = pending.get(el);
    if (!state) {
      state = { extra, timer: null };
      pending.set(el, state);
    } else {
      state.extra = extra;
    }
    if (state.timer) return;
    state.timer = setTimeout(() => {
      flushInput(el);
    }, INPUT_GAP_MS);
  }

  function inputKind(el: EventTarget | null) {
    if (el instanceof HTMLSelectElement) return 'select';
    if (el instanceof HTMLTextAreaElement) return 'text';
    if (!(el instanceof HTMLInputElement)) return '';
    const type = String(el.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio' || type === 'button' || type === 'submit') {
      return type;
    }
    if (type === 'reset' || type === 'file' || type === 'image' || type === 'hidden') return type;
    return 'text';
  }

  function fieldValue(el: EventTarget | null) {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value;
    return '';
  }

  document.addEventListener(
    'click',
    (event) => {
      const raw = event.target;
      if (!(raw instanceof Node)) return;
      const node = raw instanceof Element ? raw : raw.parentElement;
      if (!node) return;
      const el = node.closest('button, a, input, select, label, [role="button"]') || node;
      emit('click', el, null);
    },
    true,
  );

  document.addEventListener(
    'input',
    (event) => {
      const el = event.target;
      if (!(el instanceof Element) || inputKind(el) !== 'text') return;
      if (isPassword(el)) {
        queueInput(el, { masked: true, valueLength: String(fieldValue(el) || '').length });
        return;
      }
      queueInput(el, { value: String(fieldValue(el) || '') });
    },
    true,
  );

  document.addEventListener(
    'blur',
    (event) => {
      const el = event.target;
      if (el instanceof Element) flushInput(el);
    },
    true,
  );

  document.addEventListener(
    'change',
    (event) => {
      const el = event.target;
      if (!el) return;
      if (el instanceof HTMLSelectElement) {
        const option = el.options[el.selectedIndex];
        emit('select', el, { value: option ? String(option.text || '') : '' });
        return;
      }
      if (!(el instanceof HTMLInputElement)) return;
      const type = String(el.type || '').toLowerCase();
      if (type === 'checkbox' || type === 'radio') {
        emit('change', el, { value: el.checked ? 'checked' : 'unchecked' });
      }
    },
    true,
  );

  document.addEventListener(
    'submit',
    (event) => {
      const el = event.target;
      if (el instanceof Element) emit('submit', el, null);
    },
    true,
  );
};

export function pageScriptSource(bindingName: string): string {
  return `(${pageScript.toString()})(${JSON.stringify(bindingName)})`;
}
