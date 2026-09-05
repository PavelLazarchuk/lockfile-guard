import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

export type Credential = { prefix: string; header: string };

export type Auth = {
    credentials: Credential[];
    /** Every raw secret seen, so the reporter can scrub any that leaks into an error string. */
    secrets: string[];
};

export const EMPTY_AUTH: Auth = { credentials: [], secrets: [] };

const NPMRC_LINE = /^(\/\/[^\s=]+):(_authToken|_auth|_password|username)\s*=\s*(.+)$/;

function expandEnv(value: string): string | null {
    const unquoted = value.trim().replace(/^["']|["']$/g, '');
    let missing = false;

    const expanded = unquoted.replace(/\$\{([^}]+)\}/g, (_match, name: string) => {
        const found = process.env[name];
        if (found === undefined) missing = true;

        return found ?? '';
    });

    return missing ? null : expanded;
}

/**
 * Only the two forms that authenticate a plain GET are supported — `_authToken` and the base64
 * `_auth`. Registry-scoped keys keep their `//host/path/` prefix so the longest match wins.
 */
export function parseNpmrc(source: string): Auth {
    const credentials: Credential[] = [];
    const secrets: string[] = [];

    for (const line of source.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (trimmed === '' || trimmed.startsWith(';') || trimmed.startsWith('#')) continue;

        const match = NPMRC_LINE.exec(trimmed);
        if (match === null) continue;

        const [, prefix, key, rawValue] = match as unknown as [string, string, string, string];
        const value = expandEnv(rawValue);
        if (value === null || value === '') continue;

        secrets.push(value);

        if (key === '_authToken') credentials.push({ prefix, header: `Bearer ${value}` });
        else if (key === '_auth') credentials.push({ prefix, header: `Basic ${value}` });
    }

    return { credentials, secrets };
}

export async function loadAuth(cwd: string, home = homedir()): Promise<Auth> {
    const files = [resolve(home, '.npmrc'), resolve(cwd, '.npmrc')];
    const merged: Auth = { credentials: [], secrets: [] };

    for (const file of files) {
        let source: string;

        try {
            source = await readFile(file, 'utf8');
        } catch {
            continue;
        }

        const auth = parseNpmrc(source);

        // Project config is read last and must win, so it goes in front of the home entries.
        merged.credentials.unshift(...auth.credentials);
        merged.secrets.push(...auth.secrets);
    }

    return merged;
}

/** npm matches credentials by URL prefix, longest first — `//host/a/` beats `//host/`. */
export function authorizationFor(url: string, auth: Auth): string | undefined {
    let parsed: URL;

    try {
        parsed = new URL(url);
    } catch {
        return undefined;
    }

    const target = `//${parsed.host}${parsed.pathname}`;
    let best: Credential | undefined;

    for (const credential of auth.credentials) {
        const prefix = credential.prefix.endsWith('/')
            ? credential.prefix
            : `${credential.prefix}/`;

        // Only at a path boundary: `//host/a/` authenticates `//host/a/pkg` and `//host/a`, never
        // `//host/abc`, which a plain `startsWith` on the slash-stripped prefix would have matched.
        if (target !== prefix.slice(0, -1) && !target.startsWith(prefix)) continue;
        // Both sides are the normalized prefix, so a trailing slash cannot tip the comparison.
        if (best === undefined || prefix.length > best.prefix.length)
            best = { prefix, header: credential.header };
    }

    return best?.header;
}
