/**
 * Known-issue hints: convert raw error messages into actionable advice
 * by matching them against a small, ordered table of regex patterns.
 *
 * Usage:
 *   import { matchHint, decorateError } from './hints';
 *
 *   matchHint('ENOENT: node');         // -> 'Node.js not found. Install from https://nodejs.org'
 *   decorateError('ENOENT: node');     // -> 'ENOENT: node\n  Hint: Node.js not found. Install from https://nodejs.org'
 */

export interface Hint {
  pattern: RegExp;
  hint: string;
}

/**
 * Ordered list of known issues. First match wins in {@link matchHint}.
 * Keep the most specific patterns above the more generic ones.
 */
export const KNOWN_ISSUES: Hint[] = [
  { pattern: /ENOENT.*\b(node|npx)\b|\b(node|npx)\b.*ENOENT/i, hint: 'Node.js not found. Install from https://nodejs.org' },
  { pattern: /ENOENT.*\buvx\b|\buvx\b.*ENOENT/i, hint: 'uvx not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh' },
  { pattern: /ENOENT.*\bgit\b|\bgit\b.*ENOENT/i, hint: 'git not found. Install: https://git-scm.com/downloads' },
  { pattern: /ENOENT.*\bpython\b|\bpython\b.*ENOENT/i, hint: 'Python not found. Install: https://python.org' },
  { pattern: /EADDRINUSE/, hint: 'Port already in use. Find the process: lsof -i :<port>' },
  { pattern: /ECONNREFUSED.*:5432/, hint: 'Postgres not reachable. Is it running?' },
  { pattern: /ECONNREFUSED.*:3306/, hint: 'MySQL not reachable. Is it running?' },
  { pattern: /EACCES/, hint: 'Permission denied. Check file permissions or run with appropriate user' },
  { pattern: /Cannot find module/, hint: 'Missing npm dependency. Try reinstalling the server with `mcp-core uninstall` + `install`' },
  { pattern: /401|Unauthorized/i, hint: 'Authentication failed. Check env vars (API tokens).' },
  { pattern: /403|Forbidden/i, hint: 'Server refused the request. Check credentials or scope.' },
  { pattern: /timeout/i, hint: 'Operation timed out. The server might be slow or unreachable.' },
  { pattern: /ERR_REQUIRE_ESM/, hint: 'ESM/CommonJS mismatch. Update Node or check package exports.' },
];

/**
 * Return the first hint whose pattern matches the error message, or null
 * if no pattern matches (or the input is empty/null/undefined).
 */
export function matchHint(errorMessage: string | undefined | null): string | null {
  if (!errorMessage) return null;
  for (const entry of KNOWN_ISSUES) {
    if (entry.pattern.test(errorMessage)) return entry.hint;
  }
  return null;
}

/**
 * Decorate an error message with a trailing hint, if a pattern matches.
 * If no pattern matches, the original message is returned unchanged.
 *
 * Example:
 *   decorateError('ENOENT: node')
 *   // => 'ENOENT: node\n  Hint: Node.js not found. Install from https://nodejs.org'
 */
export function decorateError(errorMessage: string): string {
  const hint = matchHint(errorMessage);
  if (hint === null) return errorMessage;
  return `${errorMessage}\n  Hint: ${hint}`;
}
