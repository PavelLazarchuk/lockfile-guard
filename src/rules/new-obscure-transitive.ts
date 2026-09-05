import type { Rule } from './types';

/**
 * "Nobody downloads this" is the cheap stand-in for "this package is brand new": one batched
 * request for the whole PR instead of a packument per package, and for a typosquat or a freshly
 * planted dependency it says the same thing.
 */
const rule: Rule = {
    id: 'new-obscure-transitive',
    severity: 'medium',
    needsNetwork: true,
    description: 'A new transitive dependency almost nobody downloads.',
    needs: { downloads: true },
    check({ change, head }, config) {
        if (change.kind !== 'added' || change.pkg.direct) return null;

        const downloads = head?.weeklyDownloads;
        if (downloads === undefined || downloads >= config.minWeeklyDownloads) return null;

        return {
            evidence: `${downloads} downloads last week, threshold is ${config.minWeeklyDownloads}`,
        };
    },
};

export default rule;
