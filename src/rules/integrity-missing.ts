import { changedPackage } from '../model';
import { isHttpUrl } from '../registries';
import type { Rule } from './types';

/**
 * A tarball with no integrity hash is a tarball nothing verifies. Git and directory resolutions
 * never carry one, so only registry downloads are judged.
 */
const rule: Rule = {
    id: 'integrity-missing',
    severity: 'high',
    needsNetwork: false,
    description: 'A dependency is installed from a tarball with no integrity hash.',
    check({ change }) {
        if (change.kind === 'removed') return null;

        const pkg = changedPackage(change);
        if (pkg.integrity !== undefined) return null;
        if (pkg.resolved !== undefined && !isHttpUrl(pkg.resolved)) return null;

        return {
            evidence:
                pkg.resolved === undefined
                    ? 'no integrity hash recorded'
                    : `no integrity hash for ${pkg.resolved}`,
        };
    },
};

export default rule;
