const TOKEN_KEY = 'mcp-core.token';
let cachedToken: string | null = null;

export function resetTokenCache(): void {
  cachedToken = null;
}

export function getToken(): string {
  if (cachedToken !== null) return cachedToken;

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

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${getToken()}`, ...extra };
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try {
      const body: any = await res.json();
      if (body?.error) msg = body.error;
    } catch {}
    throw new Error(msg);
  }
  return (await res.json()) as T;
}

export interface RuntimeInfo {
  name: string;
  available: boolean;
  version: string | null;
  path: string | null;
}

export interface SystemInfo {
  os: string;
  arch?: string;
  node?: string;
  daemonActive?: boolean;
  runtimes?: Record<string, RuntimeInfo>;
}

export interface ValidationResult {
  success: boolean;
  tools: number;
  toolNames?: string[];
  latencyMs: number;
  error?: string;
  protocolVersion?: string;
  serverInfo?: { name: string; version?: string };
}

export interface ProgressEvent {
  phase: string;
  message?: string;
  data?: unknown;
  timestamp: number;
}

export interface ServerSummary {
  command: string;
  args: string[];
  clientsLinked?: string[];
}

export interface ClientInfo {
  name: string;
  status: string;
  configPath: string;
  enabled: boolean;
}

export function fetchSystem(): Promise<SystemInfo> {
  return fetch('/api/system', { headers: authHeaders() }).then(handle<SystemInfo>);
}

export function fetchServers(): Promise<Record<string, ServerSummary>> {
  return fetch('/api/servers', { headers: authHeaders() }).then(handle<Record<string, ServerSummary>>);
}

export function fetchClients(): Promise<ClientInfo[]> {
  return fetch('/api/clients', { headers: authHeaders() }).then(handle<ClientInfo[]>);
}

export function install(body: { source: string; name?: string }): Promise<{ success: boolean }> {
  return fetch('/api/install', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then(handle<{ success: boolean }>);
}

export function uninstall(body: { name: string }): Promise<{ success: boolean }> {
  return fetch('/api/uninstall', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then(handle<{ success: boolean }>);
}

export function toggleClient(body: { serverName: string; clientName: string; enable: boolean }): Promise<{ success: boolean }> {
  return fetch('/api/toggle-client', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then(handle<{ success: boolean }>);
}

export function validateServer(body: { name: string }): Promise<ValidationResult> {
  return fetch('/api/validate', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  }).then(handle<ValidationResult>);
}

/**
 * Open a Server-Sent Events stream of progress events.
 * The EventSource constructor does not accept custom headers, so the token is
 * passed via the URL query string (already a supported auth path).
 */
export function openEventStream(onEvent: (event: ProgressEvent) => void): EventSource {
  const token = getToken();
  const url = `/api/events?token=${encodeURIComponent(token)}`;
  const es = new EventSource(url);
  es.addEventListener('progress', (e: MessageEvent) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      /* ignore malformed */
    }
  });
  return es;
}
