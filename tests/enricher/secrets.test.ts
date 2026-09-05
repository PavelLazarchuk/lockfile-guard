import { describe, expect, it } from 'vitest';
import { redact, redactError, REDACTED } from '../../src/enricher/secrets';

describe('redact', () => {
    it('removes a token that was handed to it verbatim', () => {
        const token = 'npm_0123456789abcdefghij';

        expect(redact(`fetch failed for ${token}`, [token])).toBe(`fetch failed for ${REDACTED}`);
    });

    it('does not blank out a short string that only looks like a secret', () => {
        expect(redact('failed for abc', ['abc'])).toBe('failed for abc');
    });

    it.each([
        ['//registry.example.com/:_authToken=npm_secretvalue', '_authToken=***'],
        ['authorization: Bearer npm_secretvalue', 'authorization: Bearer ***'],
        ['https://registry.example.com/x?token=abc123', '?token=***'],
        ['https://user:hunter2@registry.example.com/x', 'https://***@registry.example.com/x'],
    ])('scrubs %s', (input, expected) => {
        expect(redact(input)).toContain(expected);
        expect(redact(input)).not.toContain('secretvalue');
    });
});

describe('redactError', () => {
    it('unwraps the cause, which is where fetch hides the URL', () => {
        const error = new Error('fetch failed', {
            cause: new Error('connect ECONNREFUSED https://user:pw@registry.example.com'),
        });

        expect(redactError(error)).toBe(
            'fetch failed: connect ECONNREFUSED https://***@registry.example.com'
        );
    });

    it('copes with something that is not an Error', () => {
        expect(redactError('plain string')).toBe('plain string');
    });
});
