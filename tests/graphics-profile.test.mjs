import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';
const { isMobileGraphics, supportsHDRTarget } = await import(
  cityModule('graphics-profile')
);
test('iPhone, Android and desktop-identifying iPad use compatible graphics, desktop Mac does not', () => {
  assert(
    isMobileGraphics(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',
      5,
    ),
  );
  assert(isMobileGraphics('Mozilla/5.0 (Linux; Android 14)', 5));
  assert(isMobileGraphics('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5));
  assert(!isMobileGraphics('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0));
});
test('HDR probe requires framebuffer completeness and restores its target on failure', () => {
  for (const outcome of ['ok', 'incomplete', 'throw', 'no-extension']) {
    const previous = {};
    let current = previous;
    let disposed = false;
    const renderer = {
      extensions: { has: () => outcome !== 'no-extension' },
      getContext: () => ({
        FRAMEBUFFER: 1,
        FRAMEBUFFER_COMPLETE: 2,
        checkFramebufferStatus: () => {
          if (outcome === 'throw') throw Error('driver failure');
          return outcome === 'ok' ? 2 : 3;
        },
      }),
      getRenderTarget: () => current,
      setRenderTarget: (target) => {
        current = target;
        if (target !== previous)
          target.addEventListener('dispose', () => (disposed = true));
      },
    };
    assert.equal(supportsHDRTarget(renderer), outcome === 'ok');
    assert.equal(current, previous);
    assert.equal(disposed, outcome !== 'no-extension');
  }
});
