import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXIT_CLEAN, EXIT_ERROR, EXIT_FINDINGS, run, type Io } from '../../src/cli/run';
import { CONFIG_FILENAME } from '../../src/config';
import { STICKY_MARKER } from '../../src/reporters/markdown';
import { fixture } from '../helpers';
import { mockRegistry } from '../enricher/registry';

type Harness = { io: Io; out: string[]; err: string[]; dir: string; calls: string[] };

async function harness(env: NodeJS.ProcessEnv = {}, fetchImpl?: typeof fetch): Promise<Harness> {
    const dir = await mkdtemp(join(tmpdir(), 'lfg-cli-'));
    const out: string[] = [];
    const err: string[] = [];

    await writeFile(join(dir, 'base.json'), fixture('npm/base.package-lock.json'));
    await writeFile(join(dir, 'package-lock.json'), fixture('npm/head.package-lock.json'));

    return {
        dir,
        out,
        err,
        calls: [],
        io: {
            stdout: text => out.push(text),
            stderr: text => err.push(text),
            cwd: dir,
            env,
            ...(fetchImpl === undefined ? {} : { fetchImpl }),
        },
    };
}

const offline = ['--base', 'base.json', '--head', 'package-lock.json', '--offline'];

describe('run', () => {
    it('prints a markdown report and fails on the default threshold', async () => {
        const { io, out } = await harness();

        expect(await run(offline, io)).toBe(EXIT_FINDINGS);
        expect(out.join('')).toContain(STICKY_MARKER);
        expect(out.join('')).toContain('registry-mismatch');
    });

    it('exits clean when the threshold is above every finding', async () => {
        const { io } = await harness();

        expect(await run([...offline, '--fail-on', 'none'], io)).toBe(EXIT_CLEAN);
    });

    it('exits clean when the lockfiles are the same', async () => {
        const { io, out } = await harness();

        expect(await run(['--base', 'base.json', '--head', 'base.json', '--offline'], io)).toBe(
            EXIT_CLEAN
        );
        expect(out.join('')).toContain('No dependency changes');
    });

    it('writes to a file when asked, and says where', async () => {
        const { io, dir, err } = await harness();

        await run([...offline, '--format', 'json', '--output', 'report.json'], io);

        expect(JSON.parse(await readFile(join(dir, 'report.json'), 'utf8')).findings).toHaveLength(
            4
        );
        expect(err.join('')).toContain('wrote report.json');
    });

    it('reads the config file next to the lockfiles', async () => {
        const { io, dir } = await harness();

        await writeFile(
            join(dir, CONFIG_FILENAME),
            '{ "failOn": "none", "rules": { "new-transitive": "off" } }'
        );

        expect(await run(offline, io)).toBe(EXIT_CLEAN);
        expect(await run([...offline, '--fail-on', 'critical'], io)).toBe(EXIT_FINDINGS);
    });

    it('prints help and the version without doing any work', async () => {
        const { io, out } = await harness();

        expect(await run(['--help'], io)).toBe(EXIT_CLEAN);
        expect(await run(['--version'], io)).toBe(EXIT_CLEAN);
        expect(out[0]).toContain('lockfile-guard — diff two lockfiles');
        expect(out[1]?.trim()).toMatch(/^\d+\.\d+\.\d+/);
    });

    it.each([
        [['--offline'], /--base and --head are both required/],
        [['--base', 'nope.json', '--head', 'package-lock.json'], /Cannot read/],
        [['--nonsense'], /Unknown option/],
    ])('exits 2 on %s', async (argv, message) => {
        const { io, err } = await harness();

        expect(await run(argv, io)).toBe(EXIT_ERROR);
        expect(err.join('')).toMatch(message);
    });

    it('exits 2, with a stack, when something unexpected breaks', async () => {
        const { io, dir, err } = await harness();

        await writeFile(join(dir, CONFIG_FILENAME), '{ "ignore": "not an array" }');

        expect(await run(offline, io)).toBe(EXIT_ERROR);
        expect(err.join('')).toContain('ignore must be an array');
        expect(err.join('')).not.toContain('at ');
    });

    it('prints the stack for a failure it did not anticipate', async () => {
        const { io, dir, err } = await harness();

        expect(await run([...offline, '--output', join(dir, 'no-such-dir', 'r.md')], io)).toBe(
            EXIT_ERROR
        );
        expect(err.join('')).toContain('ENOENT');
        expect(err.join('')).toContain('at ');
    });

    it('surfaces a registry warning on stderr without failing the run', async () => {
        const { io, err } = await harness();
        const mock = mockRegistry();

        mock.agent
            .get('https://registry.npmjs.org')
            .intercept({ path: /.*/ })
            .reply(503, 'down')
            .persist();
        mock.agent
            .get('https://api.npmjs.org')
            .intercept({ path: /.*/ })
            .reply(503, 'down')
            .persist();

        try {
            expect(
                await run(
                    ['--base', 'base.json', '--head', 'package-lock.json', '--fail-on', 'none'],
                    io
                )
            ).toBe(EXIT_CLEAN);
        } finally {
            mock.restore();
        }
        expect(err.join('')).toContain('registry lookup failed');
    });

    it('reports a lockfile it cannot parse as a run failure', async () => {
        const { io, dir, err } = await harness();

        await writeFile(join(dir, 'broken.json'), '{ "lockfileVersion": 1 }');

        expect(await run(['--base', 'broken.json', '--head', 'package-lock.json'], io)).toBe(
            EXIT_ERROR
        );
        expect(err.join('')).toMatch(/lockfileVersion 1/);
    });
});

describe('run --github-comment', () => {
    const calls: { url: string; method?: string; body?: string }[] = [];

    const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
        calls.push({
            url: String(url),
            ...(init?.method === undefined ? {} : { method: init.method }),
            ...(typeof init?.body === 'string' ? { body: init.body } : {}),
        });

        return new Response(JSON.stringify(String(url).includes('?') ? [] : { id: 7 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;

    it('posts the sticky comment when the action environment is there', async () => {
        calls.length = 0;
        const { io, err } = await harness(
            {
                GITHUB_TOKEN: 'ghs_secret',
                GITHUB_REPOSITORY: 'acme/app',
                GITHUB_REF: 'refs/pull/42/merge',
            },
            fakeFetch
        );

        expect(await run([...offline, '--github-comment'], io)).toBe(EXIT_FINDINGS);
        expect(calls[1]?.method).toBe('POST');
        expect(calls[1]?.body).toContain(STICKY_MARKER);
        expect(err.join('')).toContain('created comment 7');
    });

    it('posts no comment at all when no dependency changed', async () => {
        calls.length = 0;
        const { io, err } = await harness(
            {
                GITHUB_TOKEN: 'ghs_secret',
                GITHUB_REPOSITORY: 'acme/app',
                GITHUB_REF: 'refs/pull/42/merge',
            },
            fakeFetch
        );

        expect(
            await run(
                ['--base', 'base.json', '--head', 'base.json', '--offline', '--github-comment'],
                io
            )
        ).toBe(EXIT_CLEAN);
        expect(calls.every(call => call.method === undefined)).toBe(true);
        expect(err.join('')).toContain('no dependency changes — no comment posted');
    });

    it('says why it skipped the comment outside a pull request', async () => {
        const { io, err } = await harness({}, fakeFetch);

        await run([...offline, '--github-comment'], io);

        expect(err.join('')).toContain('no GitHub context');
    });

    it('refuses to post anything but markdown', async () => {
        const { io, err } = await harness({}, fakeFetch);

        expect(await run([...offline, '--github-comment', '--format', 'json'], io)).toBe(
            EXIT_ERROR
        );
        expect(err.join('')).toContain('--github-comment needs --format markdown');
    });
});

describe('run --quiet', () => {
    it('keeps the report but drops the chatter', async () => {
        const { io, err } = await harness();

        await run([...offline, '--quiet', '--output', 'report.md'], io);

        expect(err).toEqual([]);
    });
});
