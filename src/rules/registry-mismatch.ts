import { changedPackage } from '../model';
import { isAllowedRegistry, normalizeAll, resolutionRegistry } from '../registries';
import type { Rule } from './types';

/**
 * The one change nobody makes by accident. The allowlist is the configured registries plus every
 * registry the base lockfile already resolved to, so an existing internal mirror is not a finding —
 * only a resolution that moved somewhere new is.
 */
const rule: Rule = {
    id: 'registry-mismatch',
    severity: 'critical',
    needsNetwork: false,
    description: 'A dependency resolves to a registry that is not on the allowlist.',
    check({ change }, config) {
        if (change.kind === 'removed') return null;

        const pkg = changedPackage(change);
        if (pkg.resolved === undefined) return null;

        const registry = resolutionRegistry(pkg.resolved, pkg.name);
        if (registry === null) return null;

        const allowed = normalizeAll(config.registries);
        if (isAllowedRegistry(registry, allowed)) return null;

        return { evidence: `resolves to ${registry}, not to ${allowed.join(', ')}` };
    },
};

export default rule;
