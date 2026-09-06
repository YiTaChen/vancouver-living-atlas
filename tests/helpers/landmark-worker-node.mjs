import { parentPort } from 'node:worker_threads';
import { cityModule } from './city-modules.mjs';
if (typeof document !== 'undefined' || typeof window !== 'undefined')
  throw Error('Unexpected DOM');
globalThis.postMessage = (message, transfer) => {
  parentPort.postMessage(message, transfer);
  if (transfer)
    parentPort.postMessage({
      audit: true,
      detached: transfer.every((b) => b.byteLength === 0),
    });
};
await import(cityModule('landmark.worker'));
parentPort.on('message', (data) => globalThis.onmessage({ data }));
