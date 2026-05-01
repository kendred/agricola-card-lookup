// Azure Functions v4 entry. Loaded via "main" in package.json.
// Registers v4-style functions. v3 functions in sibling folders
// (strategy/, ocr/, draft/, submit-card/) continue to load from
// their function.json files alongside these.

require('./functions/probe-stream');
require('../strategy/index');
