import type { ActionName, ActionTarget, EventInput } from '../core/events.ts';
import { isRecord, isString } from '../core/validate.ts';

function isActionName(value: unknown): value is ActionName {
  return (
    value === 'click' ||
    value === 'input' ||
    value === 'change' ||
    value === 'select' ||
    value === 'submit' ||
    value === 'keydown'
  );
}

function parseTarget(value: unknown): ActionTarget | null {
  if (!isRecord(value)) return null;
  const target: ActionTarget = {};
  if (isString(value.label)) target.label = value.label;
  if (isString(value.selector)) target.selector = value.selector;
  if (isString(value.xpath)) target.xpath = value.xpath;
  return target;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function parseActionPayload(value: unknown): EventInput | null {
  if (!isRecord(value)) return null;
  if (!isActionName(value.action)) return null;
  if (typeof value.masked !== 'boolean') return null;
  const target = parseTarget(value.target);
  if (target === null) return null;

  const event: EventInput = {
    kind: 'action',
    action: value.action,
    target,
    masked: value.masked,
  };
  const valueLength = finiteNumber(value.valueLength);
  if (value.masked) {
    if (valueLength !== undefined) event.valueLength = valueLength;
    return event;
  }
  if (isString(value.value)) event.value = value.value;
  if (valueLength !== undefined) event.valueLength = valueLength;
  return event;
}
