const { TableClient } = require('@azure/data-tables');

const TABLE_NAME = 'drafts';
const SCHEMA_VERSION = 1;
const MAX_STATE_BYTES = 64 * 1024;
const REVERSE_TS_BASE = 9999999999999;

let _tableClientPromise = null;
function getTableClient() {
    if (_tableClientPromise) return _tableClientPromise;
    const conn = process.env.DRAFTS_STORAGE_CONNECTION_STRING;
    if (!conn) return Promise.reject(new Error('Storage connection string not configured.'));
    const client = TableClient.fromConnectionString(conn, TABLE_NAME, { allowInsecureConnection: false });
    _tableClientPromise = client.createTable().catch(() => {}).then(() => client);
    return _tableClientPromise;
}

function getPrincipal(req) {
    const header = req.headers && req.headers['x-ms-client-principal'];
    if (!header) return null;
    try {
        const decoded = Buffer.from(header, 'base64').toString('utf8');
        const p = JSON.parse(decoded);
        if (!p || !p.userId) return null;
        if (!Array.isArray(p.userRoles) || !p.userRoles.includes('authenticated')) return null;
        return p;
    } catch (e) {
        return null;
    }
}

function corsHeaders() {
    return {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

function respond(context, status, body) {
    context.res = {
        status,
        headers: corsHeaders(),
        body: body == null ? '' : JSON.stringify(body),
    };
}

function partitionKey(userId) {
    return 'u_' + userId;
}

function reverseTs(ts) {
    const v = (REVERSE_TS_BASE - ts).toString();
    return v.padStart(13, '0');
}

function shortId() {
    const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
    let out = '';
    for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
}

function isValidStateBlob(s) {
    if (typeof s !== 'string') return false;
    if (Buffer.byteLength(s, 'utf8') > MAX_STATE_BYTES) return false;
    return true;
}

async function loadActive(table, pk) {
    try {
        const entity = await table.getEntity(pk, 'active');
        return entity;
    } catch (e) {
        if (e && e.statusCode === 404) return null;
        throw e;
    }
}

async function getHistoryEntry(table, pk, id) {
    try {
        return await table.getEntity(pk, id);
    } catch (e) {
        if (e && e.statusCode === 404) return null;
        throw e;
    }
}

async function listHistoryEntries(table, pk) {
    // RowKey range covers all 'hist_*' rows. Upper bound 'hist`' uses backtick (0x60),
    // which sorts immediately after underscore (0x5F).
    const filterStr = `PartitionKey eq '${pk}' and RowKey ge 'hist_' and RowKey lt 'hist\`'`;
    const entries = [];
    const iter = table.listEntities({ queryOptions: { filter: filterStr } });
    for await (const ent of iter) {
        entries.push(ent);
    }
    entries.sort((a, b) => (a.rowKey < b.rowKey ? -1 : a.rowKey > b.rowKey ? 1 : 0));
    return entries;
}

module.exports = async function (context, req) {
    if (req.method === 'OPTIONS') {
        return respond(context, 204, null);
    }

    const principal = getPrincipal(req);
    if (!principal) {
        return respond(context, 401, { error: 'Authentication required.' });
    }

    const action = (req.params && req.params.action) || '';
    const id = (req.params && req.params.id) || '';
    const method = (req.method || 'GET').toUpperCase();
    const pk = partitionKey(principal.userId);

    let table;
    try {
        table = await getTableClient();
    } catch (e) {
        context.log.error('[draft] storage init failed:', e.message);
        return respond(context, 500, { error: 'Storage not configured.' });
    }

    try {
        if (action === 'active' && method === 'GET') {
            const entity = await loadActive(table, pk);
            if (!entity) return respond(context, 404, { error: 'No active draft.' });
            return respond(context, 200, {
                state: entity.state ? JSON.parse(entity.state) : null,
                lastModifiedAt: Number(entity.lastModifiedAt) || 0,
                clientId: entity.clientId || null,
                schemaVersion: entity.schemaVersion || SCHEMA_VERSION,
            });
        }

        if (action === 'active' && method === 'PUT') {
            const body = req.body || {};
            const stateBlob = JSON.stringify(body.state || {});
            if (!isValidStateBlob(stateBlob)) {
                return respond(context, 400, { error: 'state too large or invalid.' });
            }
            const lastModifiedAt = Number(body.lastModifiedAt) || Date.now();
            const clientIdValue = typeof body.clientId === 'string' ? body.clientId : '';
            const schemaVersion = Number(body.schemaVersion) || SCHEMA_VERSION;
            const entity = {
                partitionKey: pk,
                rowKey: 'active',
                state: stateBlob,
                lastModifiedAt,
                clientId: clientIdValue,
                userDetails: principal.userDetails || '',
                schemaVersion,
            };
            await table.upsertEntity(entity, 'Replace');
            return respond(context, 200, { ok: true, lastModifiedAt });
        }

        if (action === 'active' && method === 'DELETE') {
            try {
                await table.deleteEntity(pk, 'active');
            } catch (e) {
                if (!e || e.statusCode !== 404) throw e;
            }
            return respond(context, 200, { ok: true });
        }

        if (action === 'archive' && method === 'POST') {
            const body = req.body || {};
            const stateBlob = JSON.stringify(body.state || {});
            if (!isValidStateBlob(stateBlob)) {
                return respond(context, 400, { error: 'state too large or invalid.' });
            }
            const summaryMetaBlob = JSON.stringify(body.summaryMeta || {});
            const archivedAt = Date.now();
            const rowKey = `hist_${reverseTs(archivedAt)}_${shortId()}`;
            const schemaVersion = Number(body.schemaVersion) || SCHEMA_VERSION;
            const entity = {
                partitionKey: pk,
                rowKey,
                state: stateBlob,
                summaryMeta: summaryMetaBlob,
                archivedAt,
                lastModifiedAt: archivedAt,
                userDetails: principal.userDetails || '',
                schemaVersion,
            };
            await table.createEntity(entity);
            return respond(context, 200, { ok: true, id: rowKey, archivedAt });
        }

        if (action === 'history' && method === 'GET' && !id) {
            const entries = await listHistoryEntries(table, pk);
            const out = entries.map(e => ({
                id: e.rowKey,
                archivedAt: Number(e.archivedAt) || 0,
                summaryMeta: e.summaryMeta ? JSON.parse(e.summaryMeta) : {},
            }));
            return respond(context, 200, { entries: out });
        }

        if (action === 'history' && method === 'GET' && id) {
            const entity = await getHistoryEntry(table, pk, id);
            if (!entity) return respond(context, 404, { error: 'Not found.' });
            return respond(context, 200, {
                id: entity.rowKey,
                archivedAt: Number(entity.archivedAt) || 0,
                state: entity.state ? JSON.parse(entity.state) : null,
                summaryMeta: entity.summaryMeta ? JSON.parse(entity.summaryMeta) : {},
                schemaVersion: entity.schemaVersion || SCHEMA_VERSION,
            });
        }

        return respond(context, 404, { error: 'Unknown route.' });
    } catch (e) {
        context.log.error('[draft] handler error:', e && e.message, e && e.stack);
        return respond(context, 500, { error: 'Server error.', detail: e && e.message });
    }
};
