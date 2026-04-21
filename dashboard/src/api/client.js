const TOKEN_KEY = 'mcp-core.token';
let cachedToken = null;
export function resetTokenCache() {
    cachedToken = null;
}
export function getToken() {
    if (cachedToken !== null)
        return cachedToken;
    const fromUrl = new URLSearchParams(window.location.search).get('token');
    if (fromUrl) {
        sessionStorage.setItem(TOKEN_KEY, fromUrl);
        cachedToken = fromUrl;
        return fromUrl;
    }
    const fromStorage = sessionStorage.getItem(TOKEN_KEY);
    if (fromStorage) {
        cachedToken = fromStorage;
        return fromStorage;
    }
    cachedToken = '';
    return '';
}
function authHeaders(extra = {}) {
    return { Authorization: `Bearer ${getToken()}`, ...extra };
}
async function handle(res) {
    if (!res.ok) {
        let msg = `Request failed (${res.status})`;
        try {
            const body = await res.json();
            if (body?.error)
                msg = body.error;
        }
        catch { }
        throw new Error(msg);
    }
    return (await res.json());
}
export function fetchSystem() {
    return fetch('/api/system', { headers: authHeaders() }).then((handle));
}
export function fetchServers() {
    return fetch('/api/servers', { headers: authHeaders() }).then((handle));
}
export function fetchClients() {
    return fetch('/api/clients', { headers: authHeaders() }).then((handle));
}
export function install(body) {
    return fetch('/api/install', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    }).then(handle);
}
export function uninstall(body) {
    return fetch('/api/uninstall', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    }).then(handle);
}
export function toggleClient(body) {
    return fetch('/api/toggle-client', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    }).then(handle);
}
export function validateServer(body) {
    return fetch('/api/validate', {
        method: 'POST',
        headers: authHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    }).then(handle);
}
/**
 * Open a Server-Sent Events stream of progress events.
 * The EventSource constructor does not accept custom headers, so the token is
 * passed via the URL query string (already a supported auth path).
 */
export function openEventStream(onEvent) {
    const token = getToken();
    const url = `/api/events?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.addEventListener('progress', (e) => {
        try {
            onEvent(JSON.parse(e.data));
        }
        catch {
            /* ignore malformed */
        }
    });
    return es;
}
//# sourceMappingURL=client.js.map