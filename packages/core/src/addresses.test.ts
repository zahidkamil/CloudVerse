import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { collectReferences, resolveReference, stripIndexes } from './addresses.ts';

describe('stripIndexes', () => {
  it('removes numeric and quoted indexes', () => {
    expect(stripIndexes('aws_instance.web')).toBe('aws_instance.web');
    expect(stripIndexes('aws_instance.web[0]')).toBe('aws_instance.web');
    expect(stripIndexes('aws_subnet.s["a"]')).toBe('aws_subnet.s');
    expect(stripIndexes('module.net[1].aws_subnet.s["x"]')).toBe('module.net.aws_subnet.s');
    expect(stripIndexes('aws_x.y["a"]["b"]')).toBe('aws_x.y');
  });

  it('copes with dots, brackets, and escaped quotes inside keys', () => {
    expect(stripIndexes('aws_x.y["a.b"]')).toBe('aws_x.y');
    expect(stripIndexes('aws_x.y["a]b"]')).toBe('aws_x.y');
    expect(stripIndexes('aws_x.y["a\\"b"]')).toBe('aws_x.y');
    expect(stripIndexes('aws_x.y["a.b"].id')).toBe('aws_x.y.id');
  });

  // P5: inserting any indexes into an address and stripping them yields the base address.
  it('P5: strip(withIndexes(base)) equals base', () => {
    const segment = fc.stringMatching(/^[a-z][a-z0-9_]{0,6}$/);
    const index = fc.oneof(
      fc.nat({ max: 99 }).map((n) => `[${n}]`),
      fc.string().map((key) => `[${JSON.stringify(key)}]`),
    );
    const part = fc.tuple(segment, fc.array(index, { maxLength: 2 }));
    fc.assert(
      fc.property(fc.array(part, { minLength: 1, maxLength: 5 }), (parts) => {
        const base = parts.map(([name]) => name).join('.');
        const indexed = parts.map(([name, indexes]) => name + indexes.join('')).join('.');
        expect(stripIndexes(indexed)).toBe(base);
      }),
    );
  });
});

describe('resolveReference', () => {
  it('resolves resource references, with or without attributes and indexes', () => {
    expect(resolveReference('aws_subnet.a.id', '')).toEqual({ kind: 'resource', address: 'aws_subnet.a' });
    expect(resolveReference('aws_subnet.a', '')).toEqual({ kind: 'resource', address: 'aws_subnet.a' });
    expect(resolveReference('aws_subnet.a[0].id', '')).toEqual({ kind: 'resource', address: 'aws_subnet.a' });
    expect(resolveReference('aws_subnet.a["k"].id', 'module.net.')).toEqual({
      kind: 'resource',
      address: 'module.net.aws_subnet.a',
    });
  });

  it('ignores things that are not resources', () => {
    for (const ref of ['var.x', 'local.y', 'each.value', 'count.index', 'path.module', 'terraform.workspace', 'self.id', 'data.aws_ami.x.id']) {
      expect(resolveReference(ref, '')).toBeNull();
    }
    expect(resolveReference('', '')).toBeNull();
    expect(resolveReference('lonely', '')).toBeNull();
  });

  it('flags module output references without following them', () => {
    expect(resolveReference('module.net.vpc_id', '')).toEqual({ kind: 'module-output' });
  });
});

describe('collectReferences', () => {
  it('finds references in attributes, nested blocks and lists, and ignores constants', () => {
    const expressions = {
      vpc_id: { references: ['aws_vpc.v.id', 'aws_vpc.v'] },
      ami: { constant_value: 'ami-1' },
      default_action: [{ target_group_arn: { references: ['aws_lb_target_group.t.arn'] }, type: { constant_value: 'forward' } }],
      ingress: [{ rules: [{ cidr: { references: ['var.cidr'] } }] }],
    };
    expect(collectReferences(expressions)).toEqual([
      { path: 'vpc_id', reference: 'aws_vpc.v.id' },
      { path: 'vpc_id', reference: 'aws_vpc.v' },
      { path: 'default_action[0].target_group_arn', reference: 'aws_lb_target_group.t.arn' },
      { path: 'ingress[0].rules[0].cidr', reference: 'var.cidr' },
    ]);
  });

  it('tolerates junk', () => {
    expect(collectReferences(undefined)).toEqual([]);
    expect(collectReferences(null)).toEqual([]);
    expect(collectReferences('text')).toEqual([]);
    expect(collectReferences({ x: { references: [1, null, 'ok.a.b'] } })).toEqual([{ path: 'x', reference: 'ok.a.b' }]);
  });
});
