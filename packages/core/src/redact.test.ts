import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { REDACTED, redactSensitive } from './redact.ts';

describe('redactSensitive: Terraform markers', () => {
  it('redacts values marked sensitive in after/after_sensitive', () => {
    const plan = {
      resource_changes: [
        {
          change: {
            after: { name: 'db', blob: 'hunter2', nested: { keep: 'x', hide: 'y' }, list: ['a', 'b', 'c'] },
            after_sensitive: { blob: true, nested: { hide: true }, list: [false, true] },
          },
        },
      ],
    };
    const out = redactSensitive(plan);
    expect(out.resource_changes[0]?.change.after).toEqual({
      name: 'db',
      blob: REDACTED,
      nested: { keep: 'x', hide: REDACTED },
      list: ['a', REDACTED, 'c'],
    });
  });

  it('redacts whole subtrees marked true and keeps null as null', () => {
    const out = redactSensitive({
      change: { after: { whole: { a: 1, b: [2] }, nothing: null }, after_sensitive: { whole: true, nothing: true } },
    });
    expect(out.change.after).toEqual({ whole: REDACTED, nothing: null });
  });

  it('handles before/before_sensitive and values/sensitive_values', () => {
    const out = redactSensitive({
      change: { before: { s: 'one' }, before_sensitive: { s: true } },
      values: { t: 'two', u: 'three' },
      sensitive_values: { t: true },
    });
    expect(out.change.before).toEqual({ s: REDACTED });
    expect(out.values).toEqual({ t: REDACTED, u: 'three' });
  });
});

describe('redactSensitive: key-name heuristic', () => {
  it('redacts secret-looking string attributes', () => {
    const out = redactSensitive({
      password: 'p',
      db_password: 'p',
      secret_key: 's',
      api_key: 'k',
      access_key: 'a',
      private_key: 'k',
      token: 't',
      credentials: 'c',
    });
    expect(Object.values(out).every((v) => v === REDACTED)).toBe(true);
  });

  it('redacts constant_value in configuration expressions for secret-looking keys', () => {
    const out = redactSensitive({ expressions: { master_password: { constant_value: 'hunter2' }, region: { constant_value: 'us-east-1' } } });
    expect(out.expressions.master_password).toEqual({ constant_value: REDACTED });
    expect(out.expressions.region).toEqual({ constant_value: 'us-east-1' });
  });

  it('does not touch look-alike words or non-string values', () => {
    const input = { passthrough_behavior: 'WHEN_NO_MATCH', tokenizer: 'x', password: null, secret: true, retries: 3 };
    expect(redactSensitive(input)).toEqual(input);
  });
});

describe('redactSensitive: guarantees', () => {
  it('does not mutate its input', () => {
    const input = { change: { after: { a: 'x' }, after_sensitive: { a: true } }, password: 'p' };
    const copy = JSON.parse(JSON.stringify(input));
    redactSensitive(input);
    expect(input).toEqual(copy);
  });

  // P3: marked values never survive, unmarked values never change, input untouched, idempotent.
  type Pair = { value: unknown; mask: unknown };
  const pairArb: fc.Arbitrary<Pair> = fc.letrec<{ node: Pair; leaf: Pair; obj: Pair; arr: Pair }>((tie) => ({
    node: fc.oneof({ maxDepth: 3, depthSize: 'small' }, tie('leaf'), tie('obj'), tie('arr')),
    leaf: fc.tuple(fc.string({ minLength: 1 }), fc.boolean()).map(([text, marked]) => ({ value: `v:${text}`, mask: marked })),
    obj: fc.dictionary(fc.constantFrom('a', 'b', 'c', 'd'), tie('node'), { maxKeys: 4 }).map((entries) => ({
      value: Object.fromEntries(Object.entries(entries).map(([k, p]) => [k, p.value])),
      mask: Object.fromEntries(Object.entries(entries).map(([k, p]) => [k, p.mask])),
    })),
    arr: fc.array(tie('node'), { maxLength: 4 }).map((items) => ({
      value: items.map((p) => p.value),
      mask: items.map((p) => p.mask),
    })),
  })).node;

  const expected = (value: unknown, mask: unknown): unknown => {
    if (mask === true) return REDACTED;
    if (Array.isArray(value)) return value.map((v, i) => expected(v, (mask as unknown[])[i]));
    if (typeof value === 'object' && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([k, v]) => [k, expected(v, (mask as Record<string, unknown>)[k])]),
      );
    }
    return value;
  };

  it('P3: hides exactly what is marked, preserves the rest, is idempotent and pure', () => {
    fc.assert(
      fc.property(pairArb, ({ value, mask }) => {
        const plan = { change: { after: value, after_sensitive: mask } };
        const snapshot = JSON.stringify(plan);

        const once = redactSensitive(plan);
        expect(once.change.after).toEqual(expected(value, mask));
        expect(JSON.stringify(plan)).toBe(snapshot);
        expect(redactSensitive(once)).toEqual(once);
      }),
    );
  });
});
