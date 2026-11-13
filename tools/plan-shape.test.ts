import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { listPlanAddresses, validatePlanShape } from './plan-shape.ts';

const validPlan = () => ({
  format_version: '1.2',
  terraform_version: '1.16.0',
  planned_values: { root_module: {} },
  configuration: { root_module: {} },
  resource_changes: [
    {
      address: 'aws_vpc.main',
      type: 'aws_vpc',
      name: 'main',
      provider_name: 'registry.terraform.io/hashicorp/aws',
      change: { actions: ['create'] },
    },
  ],
});

describe('validatePlanShape', () => {
  it('accepts a minimal valid plan', () => {
    expect(validatePlanShape(validPlan())).toEqual([]);
  });

  it('accepts the committed sample plans', () => {
    for (const id of ['haunted', 'web']) {
      const plan = JSON.parse(readFileSync(new URL(`../packages/samples/data/${id}/plan.json`, import.meta.url), 'utf8'));
      expect(validatePlanShape(plan)).toEqual([]);
    }
  });

  it('rejects non-objects', () => {
    for (const value of [null, 42, 'plan', [], undefined]) {
      expect(validatePlanShape(value).map((i) => i.path)).toEqual(['$']);
    }
  });

  it('reports each missing top-level field', () => {
    const paths = validatePlanShape({}).map((issue) => issue.path);
    expect(paths).toEqual(
      expect.arrayContaining(['format_version', 'terraform_version', 'planned_values', 'configuration.root_module', 'resource_changes']),
    );
  });

  it('rejects an empty resource_changes array', () => {
    const plan = { ...validPlan(), resource_changes: [] };
    expect(validatePlanShape(plan).map((i) => i.path)).toContain('resource_changes');
  });

  it('rejects malformed resource entries', () => {
    const plan = validPlan();
    plan.resource_changes = [{ address: '', type: 5, name: 'x', provider_name: 'p', change: { actions: [1] } } as never];
    const paths = validatePlanShape(plan).map((i) => i.path);
    expect(paths).toEqual(
      expect.arrayContaining(['resource_changes[0].address', 'resource_changes[0].type', 'resource_changes[0].change.actions']),
    );
  });

  it('rejects duplicate addresses', () => {
    const plan = validPlan();
    plan.resource_changes.push({ ...plan.resource_changes[0]! });
    expect(validatePlanShape(plan).some((i) => i.message.includes('duplicate address'))).toBe(true);
  });
});

describe('listPlanAddresses', () => {
  it('lists addresses in plan order and tolerates junk', () => {
    const plan = validPlan();
    plan.resource_changes.push({ ...plan.resource_changes[0]!, address: 'aws_subnet.a' });
    expect(listPlanAddresses(plan)).toEqual(['aws_vpc.main', 'aws_subnet.a']);
    expect(listPlanAddresses(null)).toEqual([]);
    expect(listPlanAddresses({ resource_changes: [1, null, { address: 7 }] })).toEqual([]);
  });
});
