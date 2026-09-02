import express from 'express';
import { registerOperations, snapshotArticleMiddleware } from './operations.js';

let operationsRegistered = false;
const originalGet = express.application.get;
const originalPut = express.application.put;
const originalListen = express.application.listen;

function ensureOperations(app) {
  if (operationsRegistered) return;
  registerOperations(app);
  operationsRegistered = true;
}

// Register the new API immediately before the SPA catch-all in production.
express.application.get = function patchedGet(path, ...handlers) {
  if (path === '/{*path}') ensureOperations(this);
  return originalGet.call(this, path, ...handlers);
};

// Preserve every previous route while snapshotting the article before an edit.
express.application.put = function patchedPut(path, ...handlers) {
  if (path === '/api/articles/:id') {
    return originalPut.call(this, path, snapshotArticleMiddleware, ...handlers);
  }
  return originalPut.call(this, path, ...handlers);
};

// Development may not have a compiled client/dist yet.
express.application.listen = function patchedListen(...args) {
  ensureOperations(this);
  return originalListen.apply(this, args);
};

await import('./index.js');
