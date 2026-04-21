export declare function resetTokenCache(): void;
export declare function getToken(): string;
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
    serverInfo?: {
        name: string;
        version?: string;
    };
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
export declare function fetchSystem(): Promise<SystemInfo>;
export declare function fetchServers(): Promise<Record<string, ServerSummary>>;
export declare function fetchClients(): Promise<ClientInfo[]>;
export declare function install(body: {
    source: string;
    name?: string;
}): Promise<{
    success: boolean;
}>;
export declare function uninstall(body: {
    name: string;
}): Promise<{
    success: boolean;
}>;
export declare function toggleClient(body: {
    serverName: string;
    clientName: string;
    enable: boolean;
}): Promise<{
    success: boolean;
}>;
export declare function validateServer(body: {
    name: string;
}): Promise<ValidationResult>;
/**
 * Open a Server-Sent Events stream of progress events.
 * The EventSource constructor does not accept custom headers, so the token is
 * passed via the URL query string (already a supported auth path).
 */
export declare function openEventStream(onEvent: (event: ProgressEvent) => void): EventSource;
//# sourceMappingURL=client.d.ts.map