// Public API of @cloudverse/provider-aws. Everything outside this file is internal.
import type { ProviderAdapter } from '@cloudverse/core';

const adapter: ProviderAdapter = {
  id: 'aws',
  describe({ values }) {
    const region = values.region;
    return typeof region === 'string' && region !== ''
      ? { role: 'unknown', scope: { kind: 'region', id: region } }
      : { role: 'unknown' };
  },
};

/**
 * Teaches the core about AWS resources. For now it sets the region as the node's
 * scope; semantic roles for AWS resource types arrive with the roles work.
 */
export const awsAdapter: ProviderAdapter = Object.freeze(adapter);
