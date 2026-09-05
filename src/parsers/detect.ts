import { basename } from 'node:path';
import type { Lockfile, LockfileKind } from '../model';
import { ParseError } from './errors';
import { parseNpmLock } from './npm';
import { parsePnpmLock } from './pnpm';

const BY_FILENAME: Record<string, LockfileKind> = {
    'package-lock.json': 'npm',
    'npm-shrinkwrap.json': 'npm',
    'pnpm-lock.yaml': 'pnpm',
    'pnpm-lock.yml': 'pnpm',
};

export function detectKind(source: string, filename: string): LockfileKind {
    const byName = BY_FILENAME[basename(filename)];
    if (byName !== undefined) return byName;

    const head = source.trimStart();

    if (head.startsWith('{')) return 'npm';
    if (/^lockfileVersion:/m.test(head)) return 'pnpm';

    throw new ParseError(
        `Cannot tell what kind of lockfile ${filename} is — expected package-lock.json or pnpm-lock.yaml.`
    );
}

export function parseLockfile(source: string, filename: string): Lockfile {
    return detectKind(source, filename) === 'npm'
        ? parseNpmLock(source, filename)
        : parsePnpmLock(source, filename);
}

export { ParseError } from './errors';
