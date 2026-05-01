// Azure Functions v4 entry. Loaded via "main" in package.json.
// Registers v4-style functions. v3 functions in sibling folders
// (ocr/, draft/, submit-card/) continue to load from their
// function.json files alongside these.

const { app } = require('@azure/functions');

// Required to actually stream ReadableStream response bodies.
// Without this, the worker buffers the full body before sending,
// which is what made strategy hit the SWA 45s edge timeout even
// after the TransformStream → ReadableStream switch.
// https://aka.ms/AzFuncNodeHttpStreams
app.setup({ enableHttpStream: true });

require('./functions/probe-stream');
require('../strategy/index');
