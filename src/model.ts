export type Package = {
    name: string;
    version: string;
    resolved?: string;
    integrity?: string;
    dev: boolean;
    direct: boolean;
    path: string;
};

export type Lockfile = {
    kind: LockfileKind;
    lockfileVersion: string;
    packages: Package[];
};

export type LockfileKind = 'npm' | 'pnpm';

export type Change =
    | { kind: 'added'; pkg: Package }
    | { kind: 'removed'; pkg: Package }
    | { kind: 'version-changed'; from: Package; to: Package }
    | { kind: 'resolution-changed'; from: Package; to: Package }
    | { kind: 'integrity-changed'; from: Package; to: Package };

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type Finding = {
    rule: string;
    severity: Severity;
    pkg: Package;
    evidence: string;
};

export type VersionMeta = {
    scripts?: Record<string, string>;
    npmUser?: string;
    maintainers?: string[];
    deprecated?: string | false;
    publishedAt?: string;
    weeklyDownloads?: number;
    firstPublishedAt?: string;
};

export type EnrichedChange = {
    change: Change;
    base: VersionMeta | null;
    head: VersionMeta | null;
    error?: string;
};

export const SEVERITIES: readonly Severity[] = ['critical', 'high', 'medium', 'low'];

const SEVERITY_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export function compareSeverity(a: Severity, b: Severity): number {
    return SEVERITY_RANK[a] - SEVERITY_RANK[b];
}

export function isSeverity(value: unknown): value is Severity {
    return typeof value === 'string' && value in SEVERITY_RANK;
}

export function changedPackage(change: Change): Package {
    return change.kind === 'added' || change.kind === 'removed' ? change.pkg : change.to;
}

export function compareNames(a: string, b: string): number {
    if (a === b) return 0;

    return a < b ? -1 : 1;
}
