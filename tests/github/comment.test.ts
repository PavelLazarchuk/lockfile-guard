import { describe, expect, it, vi } from 'vitest';
import { contextFromEnv, GithubError, upsertStickyComment } from '../../src/github/comment';
import { STICKY_MARKER } from '../../src/reporters/markdown';

type Call = { url: string; init?: RequestInit };

function fakeFetch(responses: (() => Response)[]): { impl: typeof fetch; calls: Call[] } {
    const calls: Call[] = [];
    let index = 0;

    const impl = (async (url: string | URL, init?: RequestInit) => {
        calls.push({ url: String(url), ...(init === undefined ? {} : { init }) });
        const make = responses[Math.min(index, responses.length - 1)];
        index += 1;

        return make!();
    }) as unknown as typeof fetch;

    return { impl, calls };
}

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const context = {
    token: 'ghs_secret',
    repo: 'acme/app',
    prNumber: 42,
    apiUrl: 'https://api.github.com',
};

describe('contextFromEnv', () => {
    it('reads the variables an action step already has', () => {
        expect(
            contextFromEnv({
                GITHUB_TOKEN: 'ghs_x',
                GITHUB_REPOSITORY: 'acme/app',
                GITHUB_REF: 'refs/pull/7/merge',
            })
        ).toEqual({
            token: 'ghs_x',
            repo: 'acme/app',
            prNumber: 7,
            apiUrl: 'https://api.github.com',
        });
    });

    it('takes an explicit PR number and a GitHub Enterprise API URL', () => {
        expect(
            contextFromEnv({
                INPUT_TOKEN: 'ghs_x',
                GITHUB_REPOSITORY: 'acme/app',
                PR_NUMBER: '11',
                GITHUB_API_URL: 'https://github.acme.com/api/v3/',
            })
        ).toMatchObject({ prNumber: 11, apiUrl: 'https://github.acme.com/api/v3' });
    });

    it('returns null when this is not a pull request build', () => {
        expect(contextFromEnv({ GITHUB_TOKEN: 'x', GITHUB_REPOSITORY: 'acme/app' })).toBeNull();
        expect(contextFromEnv({ GITHUB_REPOSITORY: 'acme/app', PR_NUMBER: '3' })).toBeNull();
        expect(
            contextFromEnv({
                GITHUB_TOKEN: 'x',
                GITHUB_REF: 'refs/heads/main',
                GITHUB_REPOSITORY: 'a/b',
            })
        ).toBeNull();
    });
});

describe('upsertStickyComment', () => {
    it('creates the comment when there is none', async () => {
        const { impl, calls } = fakeFetch([() => json([]), () => json({ id: 100 })]);

        expect(await upsertStickyComment(context, 'body', impl)).toEqual({
            action: 'created',
            id: 100,
        });
        expect(calls[1]?.url).toBe('https://api.github.com/repos/acme/app/issues/42/comments');
        expect(calls[1]?.init?.method).toBe('POST');
    });

    it('edits the existing one instead of posting again', async () => {
        const { impl, calls } = fakeFetch([
            () =>
                json([
                    { id: 5, body: 'unrelated' },
                    { id: 9, body: `${STICKY_MARKER}\nold` },
                ]),
            () => json({ id: 9 }),
        ]);

        expect(await upsertStickyComment(context, 'new body', impl)).toEqual({
            action: 'updated',
            id: 9,
        });
        expect(calls[1]?.url).toBe('https://api.github.com/repos/acme/app/issues/comments/9');
        expect(calls[1]?.init?.method).toBe('PATCH');
    });

    it('walks past a full page of comments', async () => {
        const page = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'chatter' }));
        const { impl, calls } = fakeFetch([
            () => json(page),
            () => json([{ id: 900, body: STICKY_MARKER }]),
            () => json({ id: 900 }),
        ]);

        expect((await upsertStickyComment(context, 'body', impl)).id).toBe(900);
        expect(calls[1]?.url).toContain('page=2');
    });

    it('stops after ten pages rather than paging forever', async () => {
        const page = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'chatter' }));
        const { impl, calls } = fakeFetch([() => json(page)]);

        await upsertStickyComment(context, 'body', impl);

        expect(calls.filter(call => call.url.includes('page=')).length).toBe(10);
    });

    it('treats an answer that is not a list as no comments at all', async () => {
        const { impl } = fakeFetch([() => json({ message: 'surprise' }), () => json({ id: 3 })]);

        expect(await upsertStickyComment(context, 'body', impl)).toEqual({
            action: 'created',
            id: 3,
        });
    });

    it('does not open a new thread when the caller says there is nothing to say', async () => {
        const { impl, calls } = fakeFetch([() => json([])]);

        expect(
            await upsertStickyComment(context, 'body', impl, { createIfMissing: false })
        ).toEqual({ action: 'skipped', id: null });
        expect(calls).toHaveLength(1);
    });

    it('still corrects a comment that is already there', async () => {
        const { impl } = fakeFetch([
            () => json([{ id: 9, body: `${STICKY_MARKER}\nstale findings` }]),
            () => json({ id: 9 }),
        ]);

        expect(
            await upsertStickyComment(context, 'body', impl, { createIfMissing: false })
        ).toEqual({ action: 'updated', id: 9 });
    });

    it('reports what GitHub said when it refuses', async () => {
        const listFails = fakeFetch([() => json({ message: 'Not Found' }, 404)]);
        await expect(upsertStickyComment(context, 'body', listFails.impl)).rejects.toBeInstanceOf(
            GithubError
        );

        const writeFails = fakeFetch([() => json([]), () => json({ message: 'nope' }, 403)]);
        await expect(upsertStickyComment(context, 'body', writeFails.impl)).rejects.toThrow(
            /403.*writing the comment/
        );
    });

    it('defaults to the global fetch when none is injected', async () => {
        const spy = vi
            .spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(json([]))
            .mockResolvedValueOnce(json({ id: 1 }));

        await upsertStickyComment(context, 'body');

        expect(spy).toHaveBeenCalledTimes(2);
        spy.mockRestore();
    });
});
