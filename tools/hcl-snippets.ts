// Extracts `resource` blocks from Terraform HCL source, keyed by resource address.
//
// Terraform plan JSON does not contain HCL, but missions ask players to read the
// configuration. This scanner finds each top-level `resource "type" "name" { ... }`
// block with brace matching that understands strings, `${}` interpolation,
// comments, and heredocs.
//
// Limits: only top-level resource blocks (not module internals), and no support
// for `"${ "nested \" quotes" }"` pathologies. Fixture sources avoid those.

const RESOURCE_HEADER = /^[ \t]*resource[ \t]+"([^"]+)"[ \t]+"([^"]+)"[ \t]*\{/gm;

export function extractResourceBlocks(source: string): Record<string, string> {
  const blocks: Record<string, string> = {};
  const header = new RegExp(RESOURCE_HEADER.source, RESOURCE_HEADER.flags);

  for (let match = header.exec(source); match !== null; match = header.exec(source)) {
    const [whole, type, name] = match;
    const openIndex = match.index + whole.length - 1;
    const closeIndex = findBlockEnd(source, openIndex);
    if (closeIndex === -1) throw new Error(`Unterminated resource block: ${type}.${name}`);

    const start = match.index + whole.search(/\S/);
    blocks[`${type}.${name}`] = source.slice(start, closeIndex + 1);
    header.lastIndex = closeIndex + 1;
  }
  return blocks;
}

/** Returns the index of the `}` that closes the `{` at openIndex, or -1. */
function findBlockEnd(source: string, openIndex: number): number {
  let depth = 0;
  let i = openIndex;

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (char === '"') {
      i = skipString(source, i);
      continue;
    }
    if (char === '#' || (char === '/' && next === '/')) {
      i = skipLine(source, i);
      continue;
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) return -1;
      i = end + 2;
      continue;
    }
    if (char === '<' && next === '<') {
      const heredoc = /^<<-?([A-Za-z_][A-Za-z0-9_]*)[ \t]*\r?\n/.exec(source.slice(i));
      if (heredoc?.[1]) {
        i = skipHeredoc(source, i + heredoc[0].length, heredoc[1]);
        continue;
      }
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

/** Index just past the closing quote of the string starting at `start`. */
function skipString(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') {
      i += 2;
    } else if (char === '$' && source[i + 1] === '$') {
      i += 2; // "$$" escapes interpolation
    } else if (char === '$' && source[i + 1] === '{') {
      i = skipInterpolation(source, i + 1);
    } else if (char === '"') {
      return i + 1;
    } else {
      i++;
    }
  }
  return source.length;
}

/** Index just past the `}` matching the `{` at `start`, honoring nested strings. */
function skipInterpolation(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      i = skipString(source, i);
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return source.length;
}

function skipLine(source: string, start: number): number {
  const end = source.indexOf('\n', start);
  return end === -1 ? source.length : end + 1;
}

function skipHeredoc(source: string, bodyStart: number, marker: string): number {
  let i = bodyStart;
  while (i < source.length) {
    const lineEnd = source.indexOf('\n', i);
    const end = lineEnd === -1 ? source.length : lineEnd;
    if (source.slice(i, end).trim() === marker) return end;
    if (lineEnd === -1) break;
    i = lineEnd + 1;
  }
  return source.length;
}
