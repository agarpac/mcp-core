"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const hints_1 = require("../../src/utils/hints");
(0, vitest_1.describe)('matchHint', () => {
    (0, vitest_1.it)('returns the hint when a known pattern matches (ENOENT node)', () => {
        const hint = (0, hints_1.matchHint)('ENOENT: no such file or directory, open node');
        (0, vitest_1.expect)(hint).not.toBeNull();
        (0, vitest_1.expect)(hint).toContain('Node.js not found');
    });
    (0, vitest_1.it)('matches ENOENT npx', () => {
        const hint = (0, hints_1.matchHint)('spawn npx ENOENT');
        (0, vitest_1.expect)(hint).toContain('Node.js not found');
    });
    (0, vitest_1.it)('matches ENOENT uvx', () => {
        const hint = (0, hints_1.matchHint)('spawn uvx ENOENT');
        (0, vitest_1.expect)(hint).toContain('uvx not found');
    });
    (0, vitest_1.it)('matches ENOENT git', () => {
        const hint = (0, hints_1.matchHint)('ENOENT git');
        (0, vitest_1.expect)(hint).toContain('git not found');
    });
    (0, vitest_1.it)('matches ENOENT python', () => {
        const hint = (0, hints_1.matchHint)('ENOENT python');
        (0, vitest_1.expect)(hint).toContain('Python not found');
    });
    (0, vitest_1.it)('matches EADDRINUSE', () => {
        const hint = (0, hints_1.matchHint)('Error: listen EADDRINUSE: address already in use :::3000');
        (0, vitest_1.expect)(hint).toContain('Port already in use');
    });
    (0, vitest_1.it)('matches ECONNREFUSED on port 5432 (Postgres)', () => {
        const hint = (0, hints_1.matchHint)('connect ECONNREFUSED 127.0.0.1:5432');
        (0, vitest_1.expect)(hint).toContain('Postgres');
    });
    (0, vitest_1.it)('matches ECONNREFUSED on port 3306 (MySQL)', () => {
        const hint = (0, hints_1.matchHint)('connect ECONNREFUSED 127.0.0.1:3306');
        (0, vitest_1.expect)(hint).toContain('MySQL');
    });
    (0, vitest_1.it)('matches EACCES', () => {
        const hint = (0, hints_1.matchHint)('EACCES: permission denied');
        (0, vitest_1.expect)(hint).toContain('Permission denied');
    });
    (0, vitest_1.it)('matches Cannot find module', () => {
        const hint = (0, hints_1.matchHint)("Error: Cannot find module 'foo'");
        (0, vitest_1.expect)(hint).toContain('Missing npm dependency');
    });
    (0, vitest_1.it)('matches 401 / Unauthorized', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('HTTP 401')).toContain('Authentication failed');
        (0, vitest_1.expect)((0, hints_1.matchHint)('Unauthorized')).toContain('Authentication failed');
    });
    (0, vitest_1.it)('matches 403 / Forbidden', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('HTTP 403')).toContain('Server refused');
        (0, vitest_1.expect)((0, hints_1.matchHint)('Forbidden')).toContain('Server refused');
    });
    (0, vitest_1.it)('matches timeout', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('Operation timeout after 30s')).toContain('timed out');
    });
    (0, vitest_1.it)('matches ERR_REQUIRE_ESM', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('ERR_REQUIRE_ESM while loading module')).toContain('ESM/CommonJS');
    });
    (0, vitest_1.it)('returns null for unknown error', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('foobar random gibberish')).toBeNull();
    });
    (0, vitest_1.it)('returns null for empty string', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)('')).toBeNull();
    });
    (0, vitest_1.it)('returns null for null', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)(null)).toBeNull();
    });
    (0, vitest_1.it)('returns null for undefined', () => {
        (0, vitest_1.expect)((0, hints_1.matchHint)(undefined)).toBeNull();
    });
    (0, vitest_1.it)('exposes KNOWN_ISSUES as an array of hints', () => {
        (0, vitest_1.expect)(Array.isArray(hints_1.KNOWN_ISSUES)).toBe(true);
        (0, vitest_1.expect)(hints_1.KNOWN_ISSUES.length).toBeGreaterThan(0);
        for (const entry of hints_1.KNOWN_ISSUES) {
            (0, vitest_1.expect)(entry.pattern).toBeInstanceOf(RegExp);
            (0, vitest_1.expect)(typeof entry.hint).toBe('string');
        }
    });
});
(0, vitest_1.describe)('decorateError', () => {
    (0, vitest_1.it)('appends the matching hint to the original message', () => {
        const out = (0, hints_1.decorateError)('ENOENT: node');
        (0, vitest_1.expect)(out).toContain('ENOENT: node');
        (0, vitest_1.expect)(out).toContain('Node.js not found');
        (0, vitest_1.expect)(out).toMatch(/Hint:/);
    });
    (0, vitest_1.it)('returns the message unchanged when no hint matches', () => {
        const msg = 'some unrecognized error text';
        (0, vitest_1.expect)((0, hints_1.decorateError)(msg)).toBe(msg);
    });
    (0, vitest_1.it)('preserves the original message even when decorating', () => {
        const original = 'connect ECONNREFUSED 127.0.0.1:5432';
        const out = (0, hints_1.decorateError)(original);
        (0, vitest_1.expect)(out.startsWith(original)).toBe(true);
    });
});
//# sourceMappingURL=hints.test.js.map