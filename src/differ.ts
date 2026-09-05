import { changedPackage, compareNames, type Change, type Lockfile, type Package } from './model';

/**
 * Paths move constantly — a hoist, a dedupe, a new peer and half the tree shifts one level. So the
 * diff runs twice: exact paths first, then whatever is left over is matched by name, which is how a
 * bump that also relocated the package still reads as `version-changed` and not as add + remove.
 */
export function diffLockfiles(base: Lockfile, head: Lockfile): Change[] {
    const basePaths = new Map(base.packages.map(pkg => [pkg.path, pkg]));
    const headPaths = new Map(head.packages.map(pkg => [pkg.path, pkg]));
    const changes: Change[] = [];
    const unmatchedBase: Package[] = [];
    const unmatchedHead: Package[] = [];

    for (const [path, basePkg] of basePaths) {
        const headPkg = headPaths.get(path);

        if (headPkg === undefined) unmatchedBase.push(basePkg);
        else pushComparison(changes, basePkg, headPkg);
    }
    for (const [path, headPkg] of headPaths) if (!basePaths.has(path)) unmatchedHead.push(headPkg);

    const leftoverByName = groupByName(unmatchedBase);

    for (const headPkg of unmatchedHead) {
        const basePkg = takeCandidate(leftoverByName.get(headPkg.name), headPkg.version);

        if (basePkg === undefined) changes.push({ kind: 'added', pkg: headPkg });
        else pushComparison(changes, basePkg, headPkg);
    }
    for (const leftovers of leftoverByName.values())
        for (const basePkg of leftovers) changes.push({ kind: 'removed', pkg: basePkg });

    return sortChanges(changes);
}

/**
 * Two versions of the same package routinely coexist, and a hoist moves both paths at once. Taking
 * the first leftover would then pair 1.0.0 with 2.0.0 in both directions and invent two bumps, so a
 * leftover at the same version is claimed first and only an actual bump falls through to the rest.
 */
function takeCandidate(candidates: Package[] | undefined, version: string): Package | undefined {
    if (candidates === undefined || candidates.length === 0) return undefined;

    const exact = candidates.findIndex(candidate => candidate.version === version);

    return candidates.splice(exact === -1 ? 0 : exact, 1)[0];
}

/** One pair produces at most one change, in descending order of how much it matters. */
function pushComparison(changes: Change[], from: Package, to: Package): void {
    if (from.version !== to.version) changes.push({ kind: 'version-changed', from, to });
    else if (from.resolved !== to.resolved) changes.push({ kind: 'resolution-changed', from, to });
    else if (from.integrity !== to.integrity) changes.push({ kind: 'integrity-changed', from, to });
}

function groupByName(packages: Package[]): Map<string, Package[]> {
    const grouped = new Map<string, Package[]>();

    for (const pkg of packages) {
        const existing = grouped.get(pkg.name);

        if (existing === undefined) grouped.set(pkg.name, [pkg]);
        else existing.push(pkg);
    }

    return grouped;
}

const KIND_ORDER: Record<Change['kind'], number> = {
    added: 0,
    'version-changed': 1,
    'resolution-changed': 2,
    'integrity-changed': 3,
    removed: 4,
};

/** Deterministic order, because the markdown report is snapshot-tested and read by humans. */
function sortChanges(changes: Change[]): Change[] {
    return changes.sort((a, b) => {
        const byKind = KIND_ORDER[a.kind] - KIND_ORDER[b.kind];
        if (byKind !== 0) return byKind;

        const left = changedPackage(a);
        const right = changedPackage(b);

        return compareNames(left.name, right.name) || compareNames(left.path, right.path);
    });
}
