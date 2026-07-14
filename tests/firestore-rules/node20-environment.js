const NodeEnvironment = require('jest-environment-node');

const REQUIRED_NATIVE_WEB_GLOBALS = Object.freeze([
  'fetch',
  'Headers',
  'Request',
  'Response',
  'FormData',
]);

const nativeWebGlobals = Object.freeze(Object.fromEntries(
  REQUIRED_NATIVE_WEB_GLOBALS.map((name) => [name, globalThis[name]]),
));

class Node20Environment extends NodeEnvironment {
  constructor(config, context) {
    super(config, context);

    for (const name of REQUIRED_NATIVE_WEB_GLOBALS) {
      const value = nativeWebGlobals[name];
      if (typeof value !== 'function') {
        throw new Error('Node 20 native web globals are required for Rules tests.');
      }
      Object.defineProperty(this.global, name, {
        configurable: true,
        enumerable: false,
        value,
        writable: false,
      });
    }
  }
}

module.exports = Node20Environment;
