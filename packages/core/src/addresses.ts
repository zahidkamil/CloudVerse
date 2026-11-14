// Helpers for Terraform addresses and the references found in configuration.

/**
 * Remove `[index]` segments (`count` numbers and quoted `for_each` keys) so an
 * instance address becomes the configuration address.
 *   module.a[0].aws_subnet.s["x.y"]  ->  module.a.aws_subnet.s
 */
export function stripIndexes(address: string): string {
  let out = '';
  let i = 0;
  while (i < address.length) {
    if (address[i] !== '[') {
      out += address[i];
      i++;
      continue;
    }
    // Skip to the matching "]", honoring quoted keys that may contain "]" or ".".
    let inString = false;
    i++;
    while (i < address.length) {
      const char = address[i];
      if (inString) {
        if (char === '\\') i++;
        else if (char === '"') inString = false;
      } else if (char === '"') {
        inString = true;
      } else if (char === ']') {
        break;
      }
      i++;
    }
    i++; // past "]"
  }
  return out;
}

/** References that point at something other than a resource. */
const NON_RESOURCE_ROOTS = new Set(['var', 'local', 'each', 'count', 'path', 'terraform', 'self', 'data']);

export type ResolvedReference =
  | { readonly kind: 'resource'; readonly address: string }
  | { readonly kind: 'module-output' };

/**
 * Turn a reference string such as `aws_subnet.a.id` into a configuration address.
 * `modulePrefix` is the path of the module the reference appears in, e.g.
 * `module.net.` (empty for the root module). Returns null for variables, locals,
 * data sources, and other things that are not resources.
 */
export function resolveReference(reference: string, modulePrefix: string): ResolvedReference | null {
  const tokens = stripIndexes(reference).split('.');
  const first = tokens[0];
  if (!first || NON_RESOURCE_ROOTS.has(first)) return null;
  if (first === 'module') return { kind: 'module-output' };
  const name = tokens[1];
  if (!name) return null;
  return { kind: 'resource', address: `${modulePrefix}${first}.${name}` };
}

export interface FoundReference {
  /** Attribute path inside the resource, e.g. `default_action[0].target_group_arn`. */
  readonly path: string;
  readonly reference: string;
}

/**
 * Collect every reference in a configuration `expressions` tree. Nested blocks are
 * arrays of objects; each leaf expression is `{ constant_value }` or `{ references }`.
 */
export function collectReferences(expressions: unknown, path = ''): FoundReference[] {
  if (Array.isArray(expressions)) {
    return expressions.flatMap((entry, index) => collectReferences(entry, `${path}[${index}]`));
  }
  if (expressions === null || typeof expressions !== 'object') return [];

  const record = expressions as Record<string, unknown>;
  if (Array.isArray(record.references)) {
    return record.references
      .filter((entry): entry is string => typeof entry === 'string')
      .map((reference) => ({ path, reference }));
  }
  return Object.entries(record).flatMap(([key, entry]) =>
    key === 'constant_value' ? [] : collectReferences(entry, path === '' ? key : `${path}.${key}`),
  );
}
