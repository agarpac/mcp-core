/**
 * Runtime detection.
 *
 * Probes the local machine for the set of runtimes that the mcp-core CLI and
 * the servers it installs rely on. Two consumers in mind:
 *
 *   1. The CLI `install` / `doctor` flow — it preflights the runtimes a given
 *      server needs and prints an actionable install hint when one is missing.
 *   2. The dashboard — it shows a health panel with each runtime's version and
 *      resolved path.
 *
 * Design notes:
 *   - We shell out with `execa` but NEVER with a shell (no string command).
 *     execa v9 is ESM-only and this project is CommonJS, so we use the
 *     dynamic `await import('execa')` pattern already established elsewhere
 *     in the codebase (see `src/cli/commands/install.ts`).
 *   - Every probe uses `{ reject: false }` so that a missing binary surfaces
 *     as a regular object (exitCode !== 0) instead of a thrown error. We
 *     still catch thrown errors defensively because execa throws synchronously
 *     on some ENOENT paths before the child even spawns.
 *   - Detection runs in parallel via `Promise.all` — a cold probe is ~7 tiny
 *     spawns, but in parallel it stays under 50ms on any sane dev machine.
 */

/**
 * Names of the runtimes we probe. Keep this list in sync with KNOWN_RUNTIMES
 * below.
 */
export type RuntimeName =
  | 'node'
  | 'npm'
  | 'npx'
  | 'uvx'
  | 'python'
  | 'python3'
  | 'git';

export interface RuntimeInfo {
  name: RuntimeName;
  available: boolean;
  /** e.g. "v20.10.0". null when not available or version couldn't be parsed. */
  version: string | null;
  /** Full resolved path from `which`. null when not available. */
  path: string | null;
}

export interface RuntimeReport {
  runtimes: Record<RuntimeName, RuntimeInfo>;
  /** Names of runtimes that could not be detected on PATH. */
  missing: RuntimeName[];
}

const KNOWN_RUNTIMES: RuntimeName[] = [
  'node',
  'npm',
  'npx',
  'uvx',
  'python',
  'python3',
  'git',
];

/**
 * Dynamically import execa (it is ESM-only from v9). We resolve it lazily so
 * that simply loading this module (e.g. from the dashboard's type layer) does
 * not pay the import cost until a probe is actually requested.
 */
async function loadExeca(): Promise<
  (cmd: string, args?: string[], opts?: Record<string, unknown>) => Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>
> {
  const mod = (await import('execa')) as unknown as {
    execa: (
      cmd: string,
      args?: string[],
      opts?: Record<string, unknown>
    ) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  };
  return mod.execa;
}

/**
 * Parse the first semver triple from a version string. Returns the matched
 * substring prefixed with `v` so callers get a stable, user-facing format.
 * Returns null when no semver is present.
 */
function parseVersion(raw: string): string | null {
  const match = raw.match(/v?(\d+\.\d+\.\d+)/);
  if (!match) return null;
  // `match[0]` preserves the leading `v` when present (node style); for bare
  // numbers (npm style) we normalize to a `v` prefix so the UI stays uniform.
  return match[0].startsWith('v') ? match[0] : `v${match[1]}`;
}

/**
 * Resolve the absolute path of `bin` via `which`. Uses `{ reject: false }`
 * so a missing binary returns exitCode != 0 instead of throwing. If execa
 * itself throws (ENOENT on the `which` binary — extremely unusual) we
 * degrade to `null`.
 */
async function resolveBinaryPath(
  execa: Awaited<ReturnType<typeof loadExeca>>,
  bin: string
): Promise<string | null> {
  try {
    const res = await execa('which', [bin], { reject: false });
    if (res.exitCode !== 0) return null;
    const path = res.stdout.trim();
    return path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

/**
 * Query `bin --version`. Returns the parsed version string or null when the
 * binary fails to spawn / exits non-zero / emits no parseable version.
 */
async function probeVersion(
  execa: Awaited<ReturnType<typeof loadExeca>>,
  bin: string
): Promise<string | null> {
  try {
    const res = await execa(bin, ['--version'], { reject: false });
    if (res.exitCode !== 0) return null;
    // Some tools (looking at you, python) print the version to stderr.
    const raw = (res.stdout && res.stdout.length > 0 ? res.stdout : res.stderr) ?? '';
    return parseVersion(raw.trim());
  } catch {
    return null;
  }
}

async function detectOne(
  execa: Awaited<ReturnType<typeof loadExeca>>,
  name: RuntimeName
): Promise<RuntimeInfo> {
  // Resolve path and version in parallel — both probes are independent and
  // spawning them sequentially would double the detection wall time.
  const [path, version] = await Promise.all([
    resolveBinaryPath(execa, name),
    probeVersion(execa, name),
  ]);

  // Available iff BOTH probes succeeded. `which` alone can resolve a stale
  // symlink; `--version` alone can be a shim that prints something even when
  // the real tool is broken. Requiring both keeps the signal honest.
  const available = path !== null && version !== null;

  return {
    name,
    available,
    version: available ? version : null,
    path: available ? path : null,
  };
}

/**
 * Detect every known runtime in parallel. A single burst of spawns — no
 * sequencing between runtimes.
 */
export async function detectRuntimes(): Promise<RuntimeReport> {
  const execa = await loadExeca();

  const infos = await Promise.all(KNOWN_RUNTIMES.map((name) => detectOne(execa, name)));

  const runtimes = {} as Record<RuntimeName, RuntimeInfo>;
  const missing: RuntimeName[] = [];
  for (const info of infos) {
    runtimes[info.name] = info;
    if (!info.available) missing.push(info.name);
  }

  return { runtimes, missing };
}

/**
 * Detect a user-supplied subset of runtimes (preserving order). Used by the
 * `install` preflight which only cares about the runtimes a given server
 * declares as dependencies.
 */
export async function detectSome(names: RuntimeName[]): Promise<RuntimeInfo[]> {
  const execa = await loadExeca();
  return Promise.all(names.map((name) => detectOne(execa, name)));
}

/**
 * Human-readable install hint for a runtime. Returns null when we have no
 * canonical advice for that name (shouldn't happen for any RuntimeName, but
 * callers must tolerate null in case the union grows in the future).
 */
export function installHintFor(name: RuntimeName): string | null {
  switch (name) {
    case 'uvx':
      return 'curl -LsSf https://astral.sh/uv/install.sh | sh';
    case 'node':
      return 'Install Node.js from https://nodejs.org (v18+)';
    case 'python':
    case 'python3':
      return 'Install Python 3 from https://python.org';
    case 'git':
      return 'Install git from https://git-scm.com/downloads';
    case 'npm':
    case 'npx':
      return 'Ships with Node.js — reinstall Node.js from https://nodejs.org';
    default:
      return null;
  }
}
