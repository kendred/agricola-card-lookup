// Adapts a legacy v3 handler — `async function(context, req)` that mutates
// `context.res` — to a v4 `app.http()` handler. Needed because
// `app.setup({ enableHttpStream: true })` (set in src/index.js to make
// strategy's SSE response actually stream) changes the request shape for
// every HTTP trigger in the worker, breaking v3 functions that read
// `req.body` and `req.headers` directly.

async function buildV3Req(request) {
    const headers = {};
    for (const [k, v] of request.headers.entries()) headers[k.toLowerCase()] = v;

    let body;
    const method = request.method;
    if (method !== 'GET' && method !== 'OPTIONS' && method !== 'DELETE' && method !== 'HEAD') {
        const ct = (headers['content-type'] || '').toLowerCase();
        if (ct.includes('application/json')) {
            const text = await request.text();
            if (text.length === 0) {
                body = {};
            } else {
                try { body = JSON.parse(text); } catch { body = text; }
            }
        } else if (ct.startsWith('image/') || ct.includes('octet-stream')) {
            const ab = await request.arrayBuffer();
            body = Buffer.from(ab);
        } else if (ct.includes('text/')) {
            body = await request.text();
        } else {
            const ab = await request.arrayBuffer();
            body = Buffer.from(ab);
        }
    }

    return {
        method,
        url: request.url,
        headers,
        body,
        query: Object.fromEntries(request.query.entries()),
        params: request.params || {},
    };
}

function buildV3Context(context) {
    const log = (...args) => context.log(...args);
    log.error = (...args) => context.error(...args);
    log.warn = (...args) => context.warn(...args);
    log.info = (...args) => context.info(...args);
    log.verbose = (...args) => context.debug(...args);
    return { log, res: null };
}

function adaptV3(handler) {
    return async (request, context) => {
        const v3Req = await buildV3Req(request);
        const v3Ctx = buildV3Context(context);
        await handler(v3Ctx, v3Req);
        return v3Ctx.res || { status: 200, body: '' };
    };
}

module.exports = { adaptV3 };
