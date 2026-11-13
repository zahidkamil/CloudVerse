import { samples } from '@cloudverse/samples';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('CloudVerse Defense Lab scaffold', () => {
  beforeEach(() => {
    vi.resetModules();
    document.body.innerHTML = '<main id="app"></main>';
  });

  it('renders a heading and every bundled sample without any network access', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    await import('./main.ts');

    expect(document.querySelector('h1')?.textContent).toBe('CloudVerse Defense Lab');
    expect(document.querySelectorAll('li')).toHaveLength(samples.length);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
