import { describe, expect, it } from 'vitest';
import { evaluateEnvironment, isAtLeast, parseVersion, type EnvInfo } from './doctor.ts';

const healthy = (): EnvInfo => ({
  node: 'v24.11.1',
  npm: '11.6.2',
  corepack: '0.34.2',
  pnpm: { version: '10.34.9', via: 'corepack' },
  pinnedPnpm: '10.34.9',
  terraform: '1.16.0',
  playwright: null,
  registryReachable: true,
});

const statusOf = (info: EnvInfo, name: string) => evaluateEnvironment(info).checks.find((check) => check.name === name)?.status;

describe('version helpers', () => {
  it('parses versions with and without a leading v', () => {
    expect(parseVersion('v24.11.1')).toEqual([24, 11, 1]);
    expect(parseVersion('10.34.9')).toEqual([10, 34, 9]);
    expect(parseVersion('nonsense')).toBeNull();
  });

  it('compares versions component by component', () => {
    expect(isAtLeast([22, 12, 0], [22, 12, 0])).toBe(true);
    expect(isAtLeast([22, 11, 9], [22, 12, 0])).toBe(false);
    expect(isAtLeast([24, 0, 0], [22, 12, 0])).toBe(true);
    expect(isAtLeast([20, 99, 99], [22, 12, 0])).toBe(false);
  });
});

describe('evaluateEnvironment', () => {
  it('passes when required tools are present, warning only about optional ones', () => {
    const result = evaluateEnvironment(healthy());
    expect(result.ok).toBe(true);
    expect(statusOf(healthy(), 'Playwright')).toBe('warn');
  });

  it('fails when Node.js is missing or too old', () => {
    expect(evaluateEnvironment({ ...healthy(), node: null }).ok).toBe(false);
    const old = evaluateEnvironment({ ...healthy(), node: 'v20.1.0' });
    expect(old.ok).toBe(false);
    expect(old.checks.find((c) => c.name === 'Node.js')?.detail).toMatch(/too old/);
  });

  it('fails with actionable guidance when pnpm is unavailable', () => {
    const result = evaluateEnvironment({ ...healthy(), pnpm: null });
    expect(result.ok).toBe(false);
    const pnpm = result.checks.find((c) => c.name === 'pnpm');
    expect(pnpm?.status).toBe('fail');
    expect(pnpm?.hint).toContain('corepack pnpm');
    expect(pnpm?.hint).toContain('10.34.9');
  });

  it('warns, but does not fail, when pnpm differs from the pinned version', () => {
    const info = { ...healthy(), pnpm: { version: '9.0.0', via: 'path' as const } };
    expect(statusOf(info, 'pnpm')).toBe('warn');
    expect(evaluateEnvironment(info).ok).toBe(true);
  });

  it('treats Terraform, the registry, and Playwright as optional', () => {
    const info = { ...healthy(), terraform: null, registryReachable: false, playwright: null };
    const result = evaluateEnvironment(info);
    expect(result.ok).toBe(true);
    expect(statusOf(info, 'Terraform')).toBe('warn');
    expect(statusOf(info, 'Terraform registry')).toBe('warn');
  });

  it('does not fail on a missing Corepack when pnpm is on PATH', () => {
    const info = { ...healthy(), corepack: null, pnpm: { version: '10.34.9', via: 'path' as const } };
    expect(statusOf(info, 'Corepack')).toBe('warn');
    expect(evaluateEnvironment(info).ok).toBe(true);
  });
});
