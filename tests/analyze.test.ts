import { afterEach, describe, expect, it } from 'vitest';
import { analyze, registriesFrom, shouldFail } from '../src/analyze';
import { RegistryClient } from '../src/enricher/client';
import { parseNpmLock } from '../src/parsers/npm';
import { config, fixture } from './helpers';
import { mockRegistry } from './enricher/registry';

const NPM = 'https://registry.npmjs.org';

const base = { source: fixture('npm/base.package-lock.json'), filename: 'package-lock.json' };
const head = { source: fixture('npm/head.package-lock.json'), filename: 'package-lock.json' };

let restore = () => {};

afterEach(() => restore());

describe('registriesFrom', () => {
    it('allowlists whatever the base lockfile already resolved to', () => {
        const lock = parseNpmLock(fixture('npm/workspaces.package-lock.json'));

        expect(registriesFrom(lock, config({ registries: [NPM] }))).toEqual([
            NPM,
            'git+ssh://github.com',
        ]);
    });

    it('keeps the path prefix of a private registry it finds there', () => {
        const artifactory = 'https://art.example.com/artifactory/api/npm/npm-local';
        const lock = {
            kind: 'npm' as const,
            lockfileVersion: '3',
            packages: [
                {
                    name: 'left-pad',
                    version: '1.3.0',
                    resolved: `${artifactory}/left-pad/-/left-pad-1.3.0.tgz`,
                    dev: false,
                    direct: true,
                    path: 'node_modules/left-pad',
                },
            ],
        };

        expect(registriesFrom(lock, config({ registries: [`${NPM}/`] }))).toEqual([
            NPM,
            artifactory,
        ]);
    });
});

describe('analyze', () => {
    it('finds the offline signals without touching the network', async () => {
        const report = await analyze({ base, head, config: config({ offline: true }) });

        expect(report.findings.map(finding => `${finding.rule} ${finding.pkg.name}`)).toEqual([
            'registry-mismatch tiny-helper',
            'integrity-missing unsigned-thing',
            'new-transitive obscure-helper',
            'new-transitive unsigned-thing',
        ]);
        expect(report.summary).toEqual({
            added: 2,
            removed: 1,
            'version-changed': 1,
            'resolution-changed': 1,
            'integrity-changed': 1,
            packages: 5,
        });
        expect(report.lockfiles).toEqual({ kind: 'npm', base: '3', head: '3' });
    });

    it('adds the registry-backed findings when the network is available', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        registry.intercept({ path: '/esbuild/0.25.0' }).reply(200, {
            _npmUser: { name: 'attacker' },
            maintainers: [{ name: 'attacker' }],
            scripts: { postinstall: 'node install.js' },
        });
        registry.intercept({ path: '/esbuild/0.24.0' }).reply(200, {
            _npmUser: { name: 'evanw' },
            maintainers: [{ name: 'evanw' }],
        });
        registry.intercept({ path: '/obscure-helper/0.0.1' }).reply(200, {});
        registry.intercept({ path: '/unsigned-thing/1.0.0' }).reply(200, {});
        registry
            .intercept({ path: '/-/package/esbuild/dist-tags' })
            .reply(200, { latest: '9.9.9' });
        registry.intercept({ path: '/esbuild' }).reply(200, { time: {} });
        registry
            .intercept({ path: '/-/package/obscure-helper/dist-tags' })
            .reply(200, { latest: '0.0.1' });
        registry
            .intercept({ path: '/-/v1/search?text=obscure-helper&size=1' })
            .reply(200, { objects: [] });
        registry.intercept({ path: '/obscure-helper' }).reply(200, { time: {} });
        registry
            .intercept({ path: '/-/package/unsigned-thing/dist-tags' })
            .reply(200, { latest: '1.0.0' });
        registry
            .intercept({ path: '/-/v1/search?text=unsigned-thing&size=1' })
            .reply(200, { objects: [] });
        registry.intercept({ path: '/unsigned-thing' }).reply(200, { time: {} });
        mock.agent
            .get('https://api.npmjs.org')
            .intercept({ path: '/downloads/point/last-week/obscure-helper,unsigned-thing' })
            .reply(200, { 'obscure-helper': { downloads: 4 }, 'unsigned-thing': null });

        const client = new RegistryClient({ registries: [NPM], timeoutMs: 5_000 });
        const report = await analyze({ base, head, config: config(), client });

        expect(report.findings.map(finding => finding.rule)).toEqual([
            'registry-mismatch',
            'install-script-added',
            'publisher-changed',
            'integrity-missing',
            'maintainers-changed',
            'new-obscure-transitive',
            'new-transitive',
            'new-transitive',
        ]);
        expect(report.warnings).toEqual([]);
    });

    it('degrades to a warning when the registry is down', async () => {
        const mock = mockRegistry();
        restore = mock.restore;
        const registry = mock.agent.get(NPM);

        for (const path of ['/esbuild/0.25.0', '/obscure-helper/0.0.1', '/unsigned-thing/1.0.0'])
            registry.intercept({ path }).reply(500, 'boom');

        mock.agent
            .get('https://api.npmjs.org')
            .intercept({ path: '/downloads/point/last-week/obscure-helper,unsigned-thing' })
            .reply(500, 'boom');

        const client = new RegistryClient({ registries: [NPM], timeoutMs: 5_000 });
        const report = await analyze({ base, head, config: config(), client });

        expect(report.warnings).toHaveLength(3);
        expect(report.findings.map(finding => finding.rule)).toContain('registry-mismatch');
    });

    it('diffs a pnpm pair as readily as an npm one', async () => {
        const report = await analyze({
            base: { source: fixture('pnpm/base-v9.pnpm-lock.yaml'), filename: 'pnpm-lock.yaml' },
            head: { source: fixture('pnpm/head-v9.pnpm-lock.yaml'), filename: 'pnpm-lock.yaml' },
            config: config({ offline: true }),
        });

        expect(report.lockfiles.kind).toBe('pnpm');
        expect(report.findings.map(finding => `${finding.rule} ${finding.pkg.name}`)).toEqual([
            'registry-mismatch @scope/tiny',
            'new-transitive obscure-helper',
        ]);
    });
});

describe('shouldFail', () => {
    const report = {
        findings: [{ rule: 'x', severity: 'medium' as const, pkg: {} as never, evidence: '' }],
        warnings: [],
        changes: [],
        summary: {} as never,
        lockfiles: {} as never,
    };

    it('compares against the failOn threshold', () => {
        expect(shouldFail(report, config({ failOn: 'high' }))).toBe(false);
        expect(shouldFail(report, config({ failOn: 'medium' }))).toBe(true);
        expect(shouldFail(report, config({ failOn: 'low' }))).toBe(true);
        expect(shouldFail(report, config({ failOn: 'none' }))).toBe(false);
    });

    it('can be made to fail on a registry that went missing', () => {
        const degraded = { ...report, findings: [], warnings: ['registry down'] };

        expect(shouldFail(degraded, config())).toBe(false);
        expect(shouldFail(degraded, config({ failOnNetworkError: true }))).toBe(true);
    });
});
