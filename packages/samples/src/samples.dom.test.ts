import { describe, expect, it } from 'vitest';
import { listPlanAddresses, validatePlanShape } from '../../../tools/plan-shape.ts';
import { getSample, samples } from './index.ts';

// Runs under jsdom: if sample data could not be loaded and used in a browser-like
// environment (no Node APIs, no file system), this suite would fail.
describe('@cloudverse/samples in a browser-like environment', () => {
  it('runs in a DOM environment', () => {
    expect(typeof window).toBe('object');
    expect(typeof document).toBe('object');
  });

  it('bundles the haunted and web samples', () => {
    expect(samples.map((s) => s.id).sort()).toEqual(['haunted', 'web']);
  });

  it('exposes complete metadata for each sample', () => {
    for (const sample of samples) {
      expect(sample.title.length).toBeGreaterThan(0);
      expect(sample.description.length).toBeGreaterThan(0);
      expect(sample.generated).toBe(true);
      expect(sample.providers['hashicorp/aws']).toBeDefined();
    }
  });

  it('contains structurally valid Terraform plans', () => {
    for (const sample of samples) {
      expect(validatePlanShape(sample.plan), sample.id).toEqual([]);
    }
  });

  it('has an HCL snippet for exactly the resources in each plan', () => {
    for (const sample of samples) {
      expect(Object.keys(sample.snippets).sort(), sample.id).toEqual([...listPlanAddresses(sample.plan)].sort());
    }
  });

  it('includes the misconfigurations the security mission will rely on', () => {
    const haunted = getSample('haunted');
    expect(haunted?.snippets['aws_vpc_security_group_ingress_rule.mansion_ssh']).toContain('0.0.0.0/0');
    expect(haunted?.snippets['aws_iam_role_policy.mansion_spirit_access']).toContain('s3:*');
    expect(getSample('web')?.snippets['aws_s3_bucket_public_access_block.assets']).toContain('block_public_acls       = true');
  });

  it('looks samples up by id and is immutable', () => {
    expect(getSample('haunted')?.id).toBe('haunted');
    expect(getSample('missing')).toBeUndefined();
    expect(Object.isFrozen(samples)).toBe(true);
    expect(Object.isFrozen(getSample('web'))).toBe(true);
  });
});
