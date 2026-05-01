// Azure Functions v4 entry. Loaded via "main" in package.json.

const { app } = require('@azure/functions');

// Required to actually stream ReadableStream response bodies.
// Without this, the worker buffers the full body before sending,
// which is what made strategy hit the SWA 45s edge timeout even
// after the TransformStream → ReadableStream switch.
// https://aka.ms/AzFuncNodeHttpStreams
app.setup({ enableHttpStream: true });

require('./functions/probe-stream');
require('../strategy/index');

// Legacy v3 handlers (ocr, draft, submit-card) registered through a
// thin v4 adapter. enableHttpStream rewrites the request shape for
// every HTTP trigger in the worker, so they can no longer be loaded
// via their original function.json files.
require('./functions/ocr');
require('./functions/draft');
require('./functions/submit-card');
