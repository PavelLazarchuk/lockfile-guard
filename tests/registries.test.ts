import { describe, expect, it } from 'vitest';
import {
    isAllowedRegistry,
    isHttpUrl,
    normalizeAll,
    normalizeRegistry,
    resolutionRegistry,
} from '../src/registries';

const ARTIFACTORY = 'https://art.example.com/artifactory/api/npm/npm-local';

describe('normalizeRegistry', () => {
    it.each([
        ['https://registry.npmjs.org', 'https://registry.npmjs.org'],
        ['https://registry.npmjs.org/', 'https://registry.npmjs.org'],
        [`${ARTIFACTORY}/`, ARTIFACTORY],
        ['git+ssh://git@github.com/acme/x.git', 'git+ssh://github.com/acme/x.git'],
    ])('normalizes %s', (input, expected) => {
        expect(normalizeRegistry(input)).toBe(expected);
    });

    it('returns null for something that is not a URL', () => {
        expect(normalizeRegistry('not a url')).toBeNull();
        expect(normalizeAll(['not a url', 'https://registry.npmjs.org/'])).toEqual([
            'https://registry.npmjs.org',
        ]);
    });
});

describe('resolutionRegistry', () => {
    it('keeps the path prefix a private registry is served under', () => {
        expect(resolutionRegistry(`${ARTIFACTORY}/left-pad/-/left-pad-1.3.0.tgz`, 'left-pad')).toBe(
            ARTIFACTORY
        );
    });

    it('handles a scoped name, whose slash is part of the marker', () => {
        expect(
            resolutionRegistry(
                'https://registry.npmjs.org/@babel/core/-/core-7.0.0.tgz',
                '@babel/core'
            )
        ).toBe('https://registry.npmjs.org');
    });

    it('falls back to the origin when the URL is not shaped like a tarball', () => {
        expect(
            resolutionRegistry('https://npm.pkg.github.com/download/@acme/x/1.0.0/abc', '@acme/x')
        ).toBe('https://npm.pkg.github.com');
        expect(resolutionRegistry('git+ssh://git@github.com/acme/x.git#sha', 'x')).toBe(
            'git+ssh://github.com'
        );
        expect(resolutionRegistry('nonsense', 'x')).toBeNull();
    });
});

describe('isAllowedRegistry', () => {
    it('allows an exact match and anything nested under it', () => {
        expect(isAllowedRegistry(ARTIFACTORY, [ARTIFACTORY])).toBe(true);
        expect(isAllowedRegistry(ARTIFACTORY, ['https://art.example.com'])).toBe(true);
    });

    it('does not let a prefix leak into a lookalike host or a sibling path', () => {
        expect(
            isAllowedRegistry('https://registry.npmjs.org.evil.com', ['https://registry.npmjs.org'])
        ).toBe(false);
        expect(
            isAllowedRegistry('https://art.example.com/artifactory/api/npm/npm-other', [
                ARTIFACTORY,
            ])
        ).toBe(false);
    });
});

describe('isHttpUrl', () => {
    it('separates a fetchable registry from a git remote', () => {
        expect(isHttpUrl('https://registry.npmjs.org')).toBe(true);
        expect(isHttpUrl('git+ssh://github.com')).toBe(false);
    });
});
