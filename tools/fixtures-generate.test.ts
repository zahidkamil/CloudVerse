import { describe, expect, it } from 'vitest';
import { readLockedProviders, sandboxedEnv } from './fixtures-generate.ts';

describe('sandboxedEnv', () => {
  const ambient: NodeJS.ProcessEnv = {
    PATH: '/usr/bin',
    HOME: '/home/someone',
    AWS_PROFILE: 'production',
    AWS_ACCESS_KEY_ID: 'real-looking-id',
    AWS_SECRET_ACCESS_KEY: 'real-looking-secret',
    AWS_SESSION_TOKEN: 'real-looking-token',
    AWS_REGION: 'eu-west-1',
    TF_VAR_db_password: 'should-not-leak',
    TF_CLI_ARGS: '-parallelism=1',
  };

  const env = sandboxedEnv(ambient, '/tmp/cache');

  it('removes every ambient AWS identity and Terraform variable', () => {
    expect(env.AWS_PROFILE).toBeUndefined();
    expect(env.AWS_SESSION_TOKEN).toBeUndefined();
    expect(env.AWS_REGION).toBeUndefined();
    expect(env.TF_VAR_db_password).toBeUndefined();
    expect(env.TF_CLI_ARGS).toBeUndefined();
  });

  it('replaces credentials with mock values and disables credential files and metadata', () => {
    expect(env.AWS_ACCESS_KEY_ID).toBe('mock-access-key');
    expect(env.AWS_SECRET_ACCESS_KEY).toBe('mock-secret-key');
    expect(env.AWS_EC2_METADATA_DISABLED).toBe('true');
    expect(env.AWS_CONFIG_FILE).toBe('/dev/null');
    expect(env.AWS_SHARED_CREDENTIALS_FILE).toBe('/dev/null');
  });

  it('keeps unrelated variables and sets the plugin cache', () => {
    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/someone');
    expect(env.TF_PLUGIN_CACHE_DIR).toBe('/tmp/cache');
  });
});

describe('readLockedProviders', () => {
  it('reads exact provider versions from the committed lock files', () => {
    for (const stack of ['haunted', 'web']) {
      const lock = new URL(`../fixtures/stacks/${stack}/.terraform.lock.hcl`, import.meta.url).pathname;
      expect(readLockedProviders(lock)).toEqual({ 'hashicorp/aws': '6.73.0' });
    }
  });
});
