// Removes sensitive values from a plan before anything is built from it.
//
// Best effort, not a guarantee: users must still import sanitized files. Two layers:
//   1. Terraform's own markers: `after_sensitive`, `before_sensitive` and
//      `sensitive_values` mirror the data and say which values are sensitive.
//   2. A key-name heuristic for secret-looking attributes.

export const REDACTED = '[redacted]';

const SECRET_KEY = /(^|_)(password|passwd|secret|token|api_?key|private_?key|access_?key|credentials?)(_|$)/i;

/** Pairs of (value key, sensitivity-mask key) that Terraform emits. */
const MASKED_PAIRS: readonly (readonly [string, string])[] = [
  ['after', 'after_sensitive'],
  ['before', 'before_sensitive'],
  ['values', 'sensitive_values'],
];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Returns a redacted deep copy. The input is never modified. */
export function redactSensitive<T>(plan: T): T {
  return walk(plan) as T;
}

function walk(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(walk);
  if (!isObject(value)) return value;

  const result: Json = {};
  for (const [key, entry] of Object.entries(value)) {
    result[key] = walk(entry);
  }

  // Apply Terraform's sensitivity mirrors, using the original (unwalked) data.
  for (const [valueKey, maskKey] of MASKED_PAIRS) {
    if (valueKey in value && maskKey in value) {
      result[valueKey] = applyMask(result[valueKey], value[maskKey]);
    }
  }

  // Heuristic: secret-looking keys.
  for (const [key, entry] of Object.entries(result)) {
    if (!SECRET_KEY.test(key)) continue;
    if (typeof entry === 'string' || typeof entry === 'number') {
      result[key] = REDACTED;
    } else if (isObject(entry) && typeof entry.constant_value === 'string') {
      result[key] = { ...entry, constant_value: REDACTED };
    }
  }
  return result;
}

/** Replace every value the mask marks `true` with {@link REDACTED}. Null stays null. */
function applyMask(value: unknown, mask: unknown): unknown {
  if (mask === true) return value === null || value === undefined ? value : REDACTED;
  if (Array.isArray(value) && Array.isArray(mask)) return value.map((entry, i) => applyMask(entry, mask[i]));
  if (isObject(value) && isObject(mask)) {
    const result: Json = {};
    for (const [key, entry] of Object.entries(value)) result[key] = applyMask(entry, mask[key]);
    return result;
  }
  return value;
}
