// Strategy advisor module for Agricola draft tool
// Handles the SSE streaming call for LLM-powered draft strategy analysis.
// Uses `var` for Babel standalone compatibility.

var STRATEGY_PATH = '/api/strategy';

// --- Partial JSON recovery parser ---
// Closes open strings, brackets, and objects to make truncated JSON parseable.
// Returns a parsed object on success, null on failure.
// Used to emit progressive UI updates as the LLM streams its JSON response.
function tryParsePartial(text) {
    var s = text.trim();
    if (!s) return null;

    var depth = []; // stack of '{' or '['
    var inString = false;
    var escape = false;

    for (var i = 0; i < s.length; i++) {
        var ch = s[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\' && inString) { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === '{' || ch === '[') depth.push(ch);
        else if (ch === '}' || ch === ']') depth.pop();
    }

    // Close open string, then close open structures from inside out
    if (inString) s += '"';
    while (depth.length > 0) {
        s += depth.pop() === '{' ? '}' : ']';
    }
    // Strip trailing comma before any closer (e.g. {"a":1,} → {"a":1})
    s = s.replace(/,\s*([}\]])/g, '$1');

    try { return JSON.parse(s); } catch (e) { return null; }
}

// Returns true if partial has meaningfully more content than lastState.
// Emits on new structural keys (anywhere 3 levels deep) or when a top-level
// string value has grown by 100+ chars — avoids per-character re-renders.
function hasNewContent(partial, lastState) {
    if (!lastState) return true;
    function countKeys(obj, depth) {
        if (depth === 0 || !obj || typeof obj !== 'object') return 0;
        var n = Object.keys(obj).length;
        var vals = Object.values(obj);
        for (var i = 0; i < vals.length; i++) n += countKeys(vals[i], depth - 1);
        return n;
    }
    if (countKeys(partial, 3) > countKeys(lastState, 3)) return true;
    var keys = Object.keys(partial);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (typeof partial[k] === 'string' && typeof lastState[k] === 'string') {
            if (partial[k].length > lastState[k].length + 100) return true;
        }
    }
    return false;
}

// Parse a single SSE event block (text between \n\n delimiters) into {type, data}.
function parseSSEEvent(raw) {
    var type = 'message';
    var data = '';
    var lines = raw.split('\n');
    for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        if (line.startsWith('event: ')) type = line.slice(7).trim();
        else if (line.startsWith('data: ')) data = line.slice(6);
    }
    return { type: type, data: data };
}

var strategyAdvisor = (function () {

    // getAdvice — calls the streaming SSE endpoint and resolves with the final state.
    //
    // onProgress(partialState): optional callback fired whenever the recovery parser
    // produces a richer snapshot than the previous emit. Callers can merge this into
    // UI state for progressive rendering.
    async function getAdvice(handNames, draftedNames, othersDrafted, currentRound, playerCount, onProgress) {
        var response = await fetch(STRATEGY_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                handNames: handNames,
                draftedNames: draftedNames,
                othersDrafted: othersDrafted,
                round: currentRound,
                playerCount: playerCount === 3 ? 3 : 4,
            }),
        });

        if (response.status === 429) {
            throw new Error('Too many requests. Try again in a few minutes.');
        }
        if (!response.ok) {
            var errData = {};
            try { errData = await response.json(); } catch (e) {}
            if (errData && errData.detail) console.error('[strategy] server detail:', errData.detail);
            if (errData && errData.error) throw new Error(errData.error);
            if (response.status === 504) throw new Error('The strategy service timed out. Please try again.');
            if (response.status === 501) throw new Error('The strategy service is not set up yet.');
            if (response.status === 503) throw new Error('The strategy service is temporarily unavailable. Try again later.');
            if (response.status >= 500) throw new Error('The strategy service ran into a problem. Please try again.');
            throw new Error('Could not get strategy advice. Please try again.');
        }

        var lastState = null;
        var accumulated = '';
        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        while (true) {
            var chunk = await reader.read();
            if (chunk.done) break;

            buffer += decoder.decode(chunk.value, { stream: true });

            var eventEnd;
            while ((eventEnd = buffer.indexOf('\n\n')) !== -1) {
                var rawEvent = buffer.slice(0, eventEnd);
                buffer = buffer.slice(eventEnd + 2);

                // Skip blank lines and SSE comments (keepalive lines start with ':')
                var trimmed = rawEvent.trim();
                if (!trimmed || trimmed.charAt(0) === ':') continue;

                var event = parseSSEEvent(rawEvent);

                if (event.type === 'token') {
                    var delta;
                    try { delta = JSON.parse(event.data); } catch (e) { continue; }
                    accumulated += delta;
                    if (onProgress) {
                        var partial = tryParsePartial(accumulated);
                        if (partial && hasNewContent(partial, lastState)) {
                            lastState = partial;
                            onProgress(partial);
                        }
                    }
                } else if (event.type === 'normalized') {
                    // Server-side parsed+normalized canonical final state
                    var normalized;
                    try { normalized = JSON.parse(event.data); } catch (e) { continue; }
                    lastState = normalized;
                    if (onProgress) onProgress(normalized);
                } else if (event.type === 'done') {
                    return lastState || {};
                } else if (event.type === 'error') {
                    var errPayload = {};
                    try { errPayload = JSON.parse(event.data); } catch (e) {}
                    throw new Error(errPayload.message || 'Strategy service error.');
                }
            }
        }

        // Stream ended without an explicit done event — resolve with last known state
        return lastState || {};
    }

    // checkAvailability — sends an empty probe and returns true if the endpoint responds.
    // The server returns a plain JSON response (non-streaming) for empty bodies.
    function checkAvailability() {
        return fetch(STRATEGY_PATH, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: '{}',
        }).then(function (response) {
            return true;
        }).catch(function () {
            return false;
        });
    }

    return {
        getAdvice: getAdvice,
        checkAvailability: checkAvailability,
    };

})();
