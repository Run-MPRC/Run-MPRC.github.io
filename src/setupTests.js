/* eslint-env jest */

// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';

// Firebase Functions' Node test bundle pulls in undici, which expects the Web
// Encoding globals that Jest's jsdom environment does not provide by default.
// Use Node's standards-compatible implementations in tests only.
const { TextDecoder, TextEncoder } = require('util');
const {
  ReadableStream,
  TransformStream,
  WritableStream,
} = require('stream/web');

global.TextDecoder = TextDecoder;
global.TextEncoder = TextEncoder;
global.ReadableStream = ReadableStream;
global.TransformStream = TransformStream;
global.WritableStream = WritableStream;

// jsdom does not implement scrolling. App smoke tests need a harmless test-only
// shim because ScrollToTop invokes this API after route changes.
global.scrollTo = jest.fn();
