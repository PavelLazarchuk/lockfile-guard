import { isIgnored, type Config, type RuleSetting } from '../config';
import { NO_NEEDS, type Needs } from '../enricher';
import {
    changedPackage,
    compareNames,
    compareSeverity,
    type EnrichedChange,
    type Finding,
} from '../model';
import deprecated from './deprecated';
import installScriptAdded from './install-script-added';
import integrityMissing from './integrity-missing';
import maintainersChanged from './maintainers-changed';
import newObscureTransitive from './new-obscure-transitive';
import newTransitive from './new-transitive';
import newYoungTransitive from './new-young-transitive';
import publisherChanged from './publisher-changed';
import registryMismatch from './registry-mismatch';
import versionTooFresh from './version-too-fresh';
import type { Rule } from './types';

export const RULES: readonly Rule[] = [
    registryMismatch,
    integrityMissing,
    installScriptAdded,
    publisherChanged,
    maintainersChanged,
    versionTooFresh,
    newObscureTransitive,
    newYoungTransitive,
    deprecated,
    newTransitive,
];

export const RULES_BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map(rule => [rule.id, rule]));

export function settingFor(rule: Rule, config: Config): RuleSetting {
    return config.rules[rule.id] ?? rule.severity;
}

export function enabledRules(config: Config): Rule[] {
    return RULES.filter(rule => {
        if (settingFor(rule, config) === 'off') return false;
        if (config.offline && rule.needsNetwork) return false;
        if (rule.needs?.firstPublish === true && !config.strictAge) return false;

        return true;
    });
}

export function needsFor(rules: readonly Rule[]): Needs {
    return rules.reduce<Needs>(
        (needs, rule) => ({
            metadata: needs.metadata || rule.needs?.metadata === true,
            freshness: needs.freshness || rule.needs?.freshness === true,
            downloads: needs.downloads || rule.needs?.downloads === true,
            firstPublish: needs.firstPublish || rule.needs?.firstPublish === true,
        }),
        { ...NO_NEEDS }
    );
}

export function runRules(
    enriched: readonly EnrichedChange[],
    config: Config,
    rules: readonly Rule[] = enabledRules(config)
): Finding[] {
    const findings: Finding[] = [];

    for (const input of enriched) {
        const pkg = changedPackage(input.change);
        if (isIgnored(pkg.name, config)) continue;

        for (const rule of rules) {
            const result = rule.check(input, config);
            if (result === null) continue;

            const setting = settingFor(rule, config);

            findings.push({
                rule: rule.id,
                severity: setting === 'off' ? rule.severity : setting,
                pkg,
                evidence: result.evidence,
            });
        }
    }

    return findings.sort(
        (a, b) =>
            compareSeverity(a.severity, b.severity) ||
            compareNames(a.pkg.name, b.pkg.name) ||
            compareNames(a.rule, b.rule)
    );
}

export type { Rule, RuleResult } from './types';
