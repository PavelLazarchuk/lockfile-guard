import { describe, expect, it } from 'vitest';
import { detectKind, parseLockfile } from '../../src/parsers/detect';
import { fixture } from '../helpers';

describe('detectKind', () => {
    it.each([
        ['package-lock.json', 'npm'],
        ['/tmp/x/npm-shrinkwrap.json', 'npm'],
        ['pnpm-lock.yaml', 'pnpm'],
        ['pnpm-lock.yml', 'pnpm'],
    ])('recognizes %s by name', (filename, kind) => {
        expect(detectKind('', filename)).toBe(kind);
    });

    it('falls back to the content when the action names the file itself', () => {
        expect(detectKind('{"lockfileVersion":3}', '/tmp/base-lock-abc123')).toBe('npm');
        expect(detectKind("lockfileVersion: '9.0'\n", '/tmp/base-lock-abc123')).toBe('pnpm');
    });

    it('refuses to guess at anything else', () => {
        expect(() => detectKind('hello', 'notes.txt')).toThrow(/Cannot tell what kind/);
    });
});

describe('parseLockfile', () => {
    it('dispatches to the parser the file needs', () => {
        expect(parseLockfile(fixture('npm/base.package-lock.json'), 'package-lock.json').kind).toBe(
            'npm'
        );
        expect(parseLockfile(fixture('pnpm/v6.pnpm-lock.yaml'), 'pnpm-lock.yaml').kind).toBe(
            'pnpm'
        );
    });
});
