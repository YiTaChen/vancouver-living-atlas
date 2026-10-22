import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { createStartupDataLoader } = await import(cityModule('startup-data'));

function recorder() {
  const spans = new Map(),
    marks = [];
  return {
    spans,
    marks,
    begin(name, kind) {
      assert(!spans.has(name), 'concurrent requests need unique span names');
      spans.set(name, { name, kind, complete: false });
    },
    end(name) {
      spans.get(name).complete = true;
    },
    mark(name, detail) {
      marks.push({ name, detail });
    },
  };
}

test('normal startup keeps the Response.json fast path and forwards cancellation', async () => {
  const signal = new AbortController().signal;
  const expected = { features: [{ name: 'English Bay' }] };
  let jsonCalls = 0;
  const loader = createStartupDataLoader({
    fetch: async (url, init) => {
      assert.equal(url, '/data/land.geojson');
      assert.equal(init.signal, signal);
      return {
        ok: true,
        status: 200,
        json: async () => {
          jsonCalls++;
          return expected;
        },
        text: async () => {
          throw new Error('normal loads should not read text');
        },
      };
    },
    now: () => {
      throw new Error('normal loads should not read the clock');
    },
  });
  assert.equal(await loader.json('/data/land.geojson', { signal }), expected);
  assert.equal(jsonCalls, 1);
});

test('opt-in separates headers, body read/decode and synchronous JSON parse', async () => {
  const probe = recorder();
  let time = 10;
  const loader = createStartupDataLoader({
    probe,
    now: () => time++,
    fetch: async () => {
      time = 30;
      return {
        ok: true,
        status: 200,
        text: async () => {
          time = 80;
          return '{"city":"溫哥華"}';
        },
      };
    },
  });
  assert.deepEqual(await loader.json('/data/city.json', { label: 'city' }), {
    city: '溫哥華',
  });
  assert.deepEqual(
    [...probe.spans.values()].map(({ name, kind, complete }) => ({
      name,
      kind,
      complete,
    })),
    [
      { name: 'data.city.1.headers', kind: 'async-wall', complete: true },
      { name: 'data.city.1.body-read', kind: 'async-wall', complete: true },
      {
        name: 'data.city.1.json-parse',
        kind: 'sync-main-thread-wall',
        complete: true,
      },
    ],
  );
  assert.deepEqual(probe.marks[0], {
    name: 'data.city.1.complete',
    detail: {
      url: '/data/city.json',
      status: 200,
      headers: 20,
      'body-read': 49,
      'json-parse': 1,
      textCodeUnits: 14,
    },
  });
});

test('required HTTP failures preserve the caller message; optional failures do not decode', async () => {
  const probe = recorder();
  const loader = createStartupDataLoader({
    probe,
    fetch: async () => ({ ok: false, status: 404 }),
  });
  await assert.rejects(
    loader.json('/data/beach-coast.json', {
      errorMessage: (status) => `Could not load beach-coast (${status})`,
    }),
    /Could not load beach-coast \(404\)/,
  );
  assert.equal(
    await loader.json('/data/terrain.json', { required: false }),
    undefined,
  );
  assert([...probe.spans.values()].every((span) => span.complete));
  assert.equal(probe.spans.size, 2);
});

test('bad bodies and aborted reads close their active span and preserve the failure', async () => {
  for (const failure of ['parse', 'body', 'headers']) {
    const probe = recorder();
    const abort = new DOMException('aborted', 'AbortError');
    const loader = createStartupDataLoader({
      probe,
      fetch: async () => {
        if (failure === 'headers') throw abort;
        return {
          ok: true,
          status: 200,
          text: async () => {
            if (failure === 'body') throw abort;
            return '{broken';
          },
        };
      },
    });
    await assert.rejects(
      loader.json('/data/failure.json'),
      failure === 'parse' ? SyntaxError : (error) => error === abort,
    );
    assert([...probe.spans.values()].every((span) => span.complete));
    assert.equal(
      probe.marks.at(-1).detail.phase,
      failure === 'parse'
        ? 'json-parse'
        : failure === 'body'
          ? 'body-read'
          : 'headers',
    );
  }
});

test('instrumentation is bounded and duplicate concurrent labels stay independent', async () => {
  const probe = recorder();
  let textCalls = 0,
    jsonCalls = 0;
  const loader = createStartupDataLoader({
    probe,
    maxInstrumentedRequests: 2,
    fetch: async () => ({
      ok: true,
      status: 200,
      text: async () => {
        textCalls++;
        return '{}';
      },
      json: async () => {
        jsonCalls++;
        return {};
      },
    }),
  });
  await Promise.all(
    Array.from({ length: 4 }, () =>
      loader.json('/data/same.json', { label: 'same' }),
    ),
  );
  assert.equal(textCalls, 2);
  assert.equal(jsonCalls, 2);
  assert.equal(probe.spans.size, 6);
  assert.equal(probe.marks.length, 2);
});
