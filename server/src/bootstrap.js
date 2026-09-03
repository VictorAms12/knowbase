import express from 'express';
import { registerOperations, snapshotArticleMiddleware } from './operations.js';
import { enhancedMediaPreview, renderMediaDocument } from './documentPreview.js';
import { importedArticlePresentation } from './importedPresentation.js';

let operationsRegistered = false;
let documentPreviewRegistered = false;
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
  // Replace the legacy text-only preview response with the enhanced inline viewer.
  // The original index.js can remain unchanged while DOCX/ODT/XLSX/PPTX/text files
  // are rendered by an internal HTML route displayed in the existing media iframe.
  if (path === '/api/media/:id/preview') {
    if (!documentPreviewRegistered) {
      originalGet.call(this, '/api/media/:id/render', renderMediaDocument);
      documentPreviewRegistered = true;
    }
    return originalGet.call(this, path, enhancedMediaPreview);
  }

  // Imported Nortesys articles keep their raw extracted text in the database/FTS,
  // but the UI receives a cleaner body that points users to the original attachment.
  if (path === '/api/articles' || path === '/api/articles/:idOrSlug') {
    return originalGet.call(this, path, importedArticlePresentation, ...handlers);
  }

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
