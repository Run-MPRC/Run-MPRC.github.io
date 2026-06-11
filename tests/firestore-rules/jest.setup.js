/**
 * Polyfill Node's web-platform globals into Jest's sandboxed `node` test
 * environment.
 *
 * Node 18+ exposes ReadableStream, TextEncoder, etc. as true globals, but
 * Jest 27's jest-environment-node (shipped with react-scripts 5) runs each
 * test file in a fresh VM context that does NOT inherit them. `undici`
 * (pulled in transitively by the `firebase` SDK) dereferences ReadableStream
 * at import time, so without this shim every suite dies with
 * `ReferenceError: ReadableStream is not defined` before a single test runs.
 *
 * `setupFiles` executes before the test framework and before any test module
 * is required, so these assignments land before `firebase`/`undici` load.
 */
const { TextEncoder, TextDecoder } = require('util');
const { ReadableStream, WritableStream, TransformStream } = require('stream/web');
const { MessageChannel, MessagePort } = require('worker_threads');
const { Blob } = require('buffer');
const { performance } = require('perf_hooks');

const globals = {
  TextEncoder,
  TextDecoder,
  ReadableStream,
  WritableStream,
  TransformStream,
  MessageChannel,
  MessagePort,
  Blob,
};

for (const [name, value] of Object.entries(globals)) {
  if (typeof global[name] === 'undefined') {
    global[name] = value;
  }
}

if (typeof global.performance === 'undefined') {
  global.performance = performance;
}
