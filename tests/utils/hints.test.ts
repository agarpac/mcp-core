import { describe, it, expect } from 'vitest';
import { matchHint, decorateError, KNOWN_ISSUES } from '../../src/utils/hints';

describe('matchHint', () => {
  it('returns the hint when a known pattern matches (ENOENT node)', () => {
    const hint = matchHint('ENOENT: no such file or directory, open node');
    expect(hint).not.toBeNull();
    expect(hint).toContain('Node.js not found');
  });

  it('matches ENOENT npx', () => {
    const hint = matchHint('spawn npx ENOENT');
    expect(hint).toContain('Node.js not found');
  });

  it('matches ENOENT uvx', () => {
    const hint = matchHint('spawn uvx ENOENT');
    expect(hint).toContain('uvx not found');
  });

  it('matches ENOENT git', () => {
    const hint = matchHint('ENOENT git');
    expect(hint).toContain('git not found');
  });

  it('matches ENOENT python', () => {
    const hint = matchHint('ENOENT python');
    expect(hint).toContain('Python not found');
  });

  it('matches EADDRINUSE', () => {
    const hint = matchHint('Error: listen EADDRINUSE: address already in use :::3000');
    expect(hint).toContain('Port already in use');
  });

  it('matches ECONNREFUSED on port 5432 (Postgres)', () => {
    const hint = matchHint('connect ECONNREFUSED 127.0.0.1:5432');
    expect(hint).toContain('Postgres');
  });

  it('matches ECONNREFUSED on port 3306 (MySQL)', () => {
    const hint = matchHint('connect ECONNREFUSED 127.0.0.1:3306');
    expect(hint).toContain('MySQL');
  });

  it('matches EACCES', () => {
    const hint = matchHint('EACCES: permission denied');
    expect(hint).toContain('Permission denied');
  });

  it('matches Cannot find module', () => {
    const hint = matchHint("Error: Cannot find module 'foo'");
    expect(hint).toContain('Missing npm dependency');
  });

  it('matches 401 / Unauthorized', () => {
    expect(matchHint('HTTP 401')).toContain('Authentication failed');
    expect(matchHint('Unauthorized')).toContain('Authentication failed');
  });

  it('matches 403 / Forbidden', () => {
    expect(matchHint('HTTP 403')).toContain('Server refused');
    expect(matchHint('Forbidden')).toContain('Server refused');
  });

  it('matches timeout', () => {
    expect(matchHint('Operation timeout after 30s')).toContain('timed out');
  });

  it('matches ERR_REQUIRE_ESM', () => {
    expect(matchHint('ERR_REQUIRE_ESM while loading module')).toContain('ESM/CommonJS');
  });

  it('returns null for unknown error', () => {
    expect(matchHint('foobar random gibberish')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(matchHint('')).toBeNull();
  });

  it('returns null for null', () => {
    expect(matchHint(null)).toBeNull();
  });

  it('returns null for undefined', () => {
    expect(matchHint(undefined)).toBeNull();
  });

  it('exposes KNOWN_ISSUES as an array of hints', () => {
    expect(Array.isArray(KNOWN_ISSUES)).toBe(true);
    expect(KNOWN_ISSUES.length).toBeGreaterThan(0);
    for (const entry of KNOWN_ISSUES) {
      expect(entry.pattern).toBeInstanceOf(RegExp);
      expect(typeof entry.hint).toBe('string');
    }
  });
});

describe('decorateError', () => {
  it('appends the matching hint to the original message', () => {
    const out = decorateError('ENOENT: node');
    expect(out).toContain('ENOENT: node');
    expect(out).toContain('Node.js not found');
    expect(out).toMatch(/Hint:/);
  });

  it('returns the message unchanged when no hint matches', () => {
    const msg = 'some unrecognized error text';
    expect(decorateError(msg)).toBe(msg);
  });

  it('preserves the original message even when decorating', () => {
    const original = 'connect ECONNREFUSED 127.0.0.1:5432';
    const out = decorateError(original);
    expect(out.startsWith(original)).toBe(true);
  });
});
