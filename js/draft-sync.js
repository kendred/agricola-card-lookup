// Cloud sync module for the draft tool.
// Auth is handled by Azure Static Web Apps (GitHub OAuth); this module just
// makes calls to /api/draft/* with credentials and reads /.auth/me.
// Uses `var` for Babel standalone compatibility (matches strategy-advisor.js).

var draftSync = (function () {

    var DRAFT_API = '/api/draft';
    var AUTH_ME = '/.auth/me';
    var SCHEMA_VERSION = 1;
    var USER_CACHE_TTL_MS = 30 * 1000;

    var LOGIN_URL = '/.auth/login/github?post_login_redirect_uri=/draft.html';
    var LOGOUT_URL = '/.auth/logout?post_logout_redirect_uri=/draft.html';

    // Per-tab client ID — used so the server can echo back which client wrote a row,
    // letting us detect "did I just write this?" on a subsequent read.
    var _clientId = (function () {
        var alphabet = 'abcdefghjkmnpqrstvwxyz0123456789';
        var out = '';
        for (var i = 0; i < 16; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
        return out;
    })();

    var _userCache = null;
    var _userCacheAt = 0;

    function _request(path, method, body) {
        var opts = {
            method: method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
        };
        if (body !== undefined) opts.body = JSON.stringify(body);
        return fetch(DRAFT_API + path, opts).then(function (res) {
            if (res.status === 204) return null;
            return res.json().catch(function () { return null; }).then(function (data) {
                if (!res.ok) {
                    var msg = (data && data.error) || ('Request failed (' + res.status + ').');
                    var err = new Error(msg);
                    err.status = res.status;
                    err.data = data;
                    throw err;
                }
                return data;
            });
        });
    }

    function getCurrentUser(opts) {
        var force = opts && opts.force;
        var now = Date.now();
        if (!force && _userCache !== null && (now - _userCacheAt) < USER_CACHE_TTL_MS) {
            return Promise.resolve(_userCache);
        }
        return fetch(AUTH_ME, { credentials: 'same-origin' })
            .then(function (res) {
                if (!res.ok) return { clientPrincipal: null };
                return res.json();
            })
            .then(function (data) {
                var p = data && data.clientPrincipal;
                _userCache = p ? {
                    userId: p.userId,
                    userDetails: p.userDetails,
                    identityProvider: p.identityProvider,
                } : null;
                _userCacheAt = Date.now();
                return _userCache;
            })
            .catch(function () {
                _userCache = null;
                _userCacheAt = Date.now();
                return null;
            });
    }

    function clearUserCache() {
        _userCache = null;
        _userCacheAt = 0;
    }

    function loadActiveDraft() {
        return _request('/active', 'GET').then(function (data) {
            return data;
        }).catch(function (err) {
            if (err && err.status === 404) return null;
            throw err;
        });
    }

    function saveActiveDraft(state) {
        var lastModifiedAt = Date.now();
        return _request('/active', 'PUT', {
            state: state,
            lastModifiedAt: lastModifiedAt,
            clientId: _clientId,
            schemaVersion: SCHEMA_VERSION,
        }).then(function (data) {
            return { lastModifiedAt: (data && data.lastModifiedAt) || lastModifiedAt };
        });
    }

    function deleteActiveDraft() {
        return _request('/active', 'DELETE');
    }

    function archiveDraft(state, summaryMeta) {
        return _request('/archive', 'POST', {
            state: state,
            summaryMeta: summaryMeta || {},
            schemaVersion: SCHEMA_VERSION,
        });
    }

    function listHistory() {
        return _request('/history', 'GET');
    }

    function getHistoryEntry(id) {
        return _request('/history/' + encodeURIComponent(id), 'GET');
    }

    return {
        LOGIN_URL: LOGIN_URL,
        LOGOUT_URL: LOGOUT_URL,
        SCHEMA_VERSION: SCHEMA_VERSION,
        getClientId: function () { return _clientId; },
        getCurrentUser: getCurrentUser,
        clearUserCache: clearUserCache,
        loadActiveDraft: loadActiveDraft,
        saveActiveDraft: saveActiveDraft,
        deleteActiveDraft: deleteActiveDraft,
        archiveDraft: archiveDraft,
        listHistory: listHistory,
        getHistoryEntry: getHistoryEntry,
    };

})();
