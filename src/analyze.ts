import type { Config } from './config';
import { diffLockfiles } from './differ';
import { createClient, enrich, type RegistryClient } from './enricher';
import { compareSeverity, type Change, type Finding, type Lockfile, type Severity } from './model';
import { parseLockfile } from './parsers/detect';
import { enabledRules, needsFor, runRules } from './rules';
import { normalizeAll, resolutionRegistry } from './registries';

export type LockfileInput = { source: string; filename: string };

export type AnalyzeOptions = {
    base: LockfileInput;
    head: LockfileInput;
    config: Config;
    client?: RegistryClient;
    cwd?: string;
};

export type Report = {
    findings: Finding[];
    warnings: string[];
    changes: Change[];
    summary: Record<Change['kind'], number> & { packages: number };
    lockfiles: { kind: Lockfile['kind']; base: string; head: string };
};

/**
 * Zero configuration means the allowlist has to come from somewhere: whatever the base lockfile
 * already resolved to is, by definition, a registry this repository has been using.
 */
export function registriesFrom(base: Lockfile, config: Config): string[] {
    const registries = new Set(normalizeAll(config.registries));

    for (const pkg of base.packages) {
        if (pkg.resolved === undefined) continue;

        const registry = resolutionRegistry(pkg.resolved, pkg.name);
        if (registry !== null) registries.add(registry);
    }

    return [...registries];
}

export async function analyze(options: AnalyzeOptions): Promise<Report> {
    const base = parseLockfile(options.base.source, options.base.filename);
    const head = parseLockfile(options.head.source, options.head.filename);
    const config: Config = { ...options.config, registries: registriesFrom(base, options.config) };
    const changes = diffLockfiles(base, head);
    const rules = enabledRules(config);
    const needs = needsFor(rules);
    const wantsNetwork = !config.offline && Object.values(needs).some(Boolean);
    const client =
        options.client ??
        (wantsNetwork ? await createClient(config, options.cwd ?? process.cwd()) : null);

    const enriched =
        client === null
            ? { changes: changes.map(change => ({ change, base: null, head: null })), warnings: [] }
            : await enrich(changes, config, needs, client);

    return {
        findings: runRules(enriched.changes, config, rules),
        warnings: enriched.warnings,
        changes,
        summary: summarize(changes, head),
        lockfiles: { kind: head.kind, base: base.lockfileVersion, head: head.lockfileVersion },
    };
}

function summarize(changes: readonly Change[], head: Lockfile): Report['summary'] {
    const summary: Report['summary'] = {
        added: 0,
        removed: 0,
        'version-changed': 0,
        'resolution-changed': 0,
        'integrity-changed': 0,
        packages: head.packages.length,
    };

    for (const change of changes) summary[change.kind] += 1;

    return summary;
}

export function shouldFail(report: Report, config: Config): boolean {
    if (config.failOnNetworkError && report.warnings.length > 0) return true;
    if (config.failOn === 'none') return false;

    const threshold: Severity = config.failOn;

    return report.findings.some(finding => compareSeverity(finding.severity, threshold) <= 0);
}
