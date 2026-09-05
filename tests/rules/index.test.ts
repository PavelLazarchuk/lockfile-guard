import { describe, expect, it } from 'vitest';
import { enabledRules, needsFor, RULES, RULES_BY_ID, runRules, settingFor } from '../../src/rules';
import { added, bumped, config } from '../helpers';

describe('the rule registry', () => {
    it('has a unique id and a description for every rule', () => {
        expect(RULES_BY_ID.size).toBe(RULES.length);
        expect(RULES.every(rule => rule.description.endsWith('.'))).toBe(true);
    });

    it('resolves a severity from the config, falling back to the rule default', () => {
        const rule = RULES_BY_ID.get('deprecated')!;

        expect(settingFor(rule, config())).toBe('low');
        expect(settingFor(rule, config({ rules: { deprecated: 'off' } }))).toBe('off');
        expect(settingFor(rule, config({ rules: { deprecated: 'high' } }))).toBe('high');
    });
});

describe('enabledRules', () => {
    it('drops the network rules when offline', () => {
        expect(enabledRules(config({ offline: true })).map(rule => rule.id)).toEqual([
            'registry-mismatch',
            'integrity-missing',
            'new-transitive',
        ]);
    });

    it('drops a rule the config turned off', () => {
        const ids = enabledRules(config({ rules: { 'new-transitive': 'off' } })).map(
            rule => rule.id
        );

        expect(ids).not.toContain('new-transitive');
    });

    it('enables the packument-backed age rule only under strict age', () => {
        expect(enabledRules(config()).map(rule => rule.id)).not.toContain('new-young-transitive');
        expect(enabledRules(config({ strictAge: true })).map(rule => rule.id)).toContain(
            'new-young-transitive'
        );
    });
});

describe('needsFor', () => {
    it('asks for nothing when only the offline rules are enabled', () => {
        expect(needsFor(enabledRules(config({ offline: true })))).toEqual({
            metadata: false,
            freshness: false,
            downloads: false,
            firstPublish: false,
        });
    });

    it('unions what the enabled rules read', () => {
        expect(needsFor(enabledRules(config({ strictAge: true })))).toEqual({
            metadata: true,
            freshness: true,
            downloads: true,
            firstPublish: true,
        });
    });
});

describe('runRules', () => {
    const input = [
        added(
            { name: 'obscure-helper', direct: false, integrity: undefined },
            { weeklyDownloads: 1 }
        ),
        bumped(
            { name: 'esbuild', version: '0.24.0' },
            { name: 'esbuild', version: '0.25.0' },
            { npmUser: 'evanw' },
            { npmUser: 'attacker', scripts: { postinstall: 'node install.js' } }
        ),
    ];

    it('sorts findings by severity, then package, then rule', () => {
        expect(
            runRules(input, config()).map(finding => `${finding.severity} ${finding.rule}`)
        ).toEqual([
            'high install-script-added',
            'high publisher-changed',
            'high integrity-missing',
            'medium new-obscure-transitive',
            'low new-transitive',
        ]);
    });

    it('applies a severity override from the config', () => {
        const findings = runRules(input, config({ rules: { 'new-transitive': 'critical' } }));

        expect(findings[0]).toMatchObject({ rule: 'new-transitive', severity: 'critical' });
    });

    it('skips a package the ignore list covers', () => {
        expect(runRules(input, config({ ignore: ['esbuild', 'obscure-*'] }))).toEqual([]);
    });

    it('carries the head package into every finding', () => {
        const findings = runRules(input, config());

        expect(findings.find(finding => finding.rule === 'publisher-changed')?.pkg.version).toBe(
            '0.25.0'
        );
    });
});
