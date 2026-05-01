// SSE buffering probe. Step 0 of STREAMING_PLAN.md.
//
// Emits a `: keepalive` SSE comment every second for 10 ticks, then
// `event: done`. Used to verify that the SWA edge proxy and the Azure
// Functions Flex Consumption host both forward chunked text/event-stream
// responses without buffering. If `curl --no-buffer` against this
// endpoint shows lines arriving roughly every second, streaming works
// end-to-end. If the body arrives in one chunk after ~10s, something
// in the path is buffering and the streaming strategy advisor needs a
// different escape hatch.
//
// Safe to delete once the streaming strategy work has shipped and is
// known to be working.

const { app } = require('@azure/functions');

app.http('probeStream', {
    methods: ['GET'],
    authLevel: 'anonymous',
    route: 'probe-stream',
    handler: async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            async start(controller) {
                for (let i = 0; i < 10; i++) {
                    const line = `: keepalive ${i} ${new Date().toISOString()}\n\n`;
                    controller.enqueue(encoder.encode(line));
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                }
                controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'));
                controller.close();
            },
        });

        return {
            status: 200,
            headers: {
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'X-Accel-Buffering': 'no',
                'Access-Control-Allow-Origin': '*',
            },
            body: stream,
        };
    },
});
