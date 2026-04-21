import fs from 'fs';
import path from 'path';
import { CORE_CONFIG_FILE, CORE_DIR, SERVERS_DIR, LOGS_DIR } from './paths';

export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
  clientsLinked?: string[]; // ej: ['cursor', 'opencode']
  sourcePath?: string; // Ruta original si fue migrado
}

export interface CoreConfig {
  servers: Record<string, McpServerConfig>;
  version: string;
}

export class ConfigStore {
  private static config: CoreConfig;

  public static initialize(): void {
    if (!fs.existsSync(CORE_DIR)) {
      fs.mkdirSync(CORE_DIR, { recursive: true });
    }
    if (!fs.existsSync(SERVERS_DIR)) {
      fs.mkdirSync(SERVERS_DIR, { recursive: true });
    }
    if (!fs.existsSync(LOGS_DIR)) {
      fs.mkdirSync(LOGS_DIR, { recursive: true });
    }

    if (!fs.existsSync(CORE_CONFIG_FILE)) {
      this.config = { servers: {}, version: '1.0.0' };
      this.save();
    } else {
      this.config = JSON.parse(fs.readFileSync(CORE_CONFIG_FILE, 'utf-8'));
    }
  }

  public static get(): CoreConfig {
    if (!this.config) this.initialize();
    return this.config;
  }

  public static save(): void {
    fs.writeFileSync(CORE_CONFIG_FILE, JSON.stringify(this.config, null, 2));
  }

  public static addServer(name: string, config: McpServerConfig): void {
    const state = this.get();
    state.servers[name] = config;
    this.save();
  }

  public static removeServer(name: string): void {
    const state = this.get();
    delete state.servers[name];
    this.save();
  }
}
