import type { Rule } from './types';

/**
 * Informational by design: every dependency bump drags new transitives in. It is `low` and below
 * the default `failOn` precisely so that it can be read rather than muted.
 */
const rule: Rule = {
    id: 'new-transitive',
    severity: 'low',
    needsNetwork: false,
    description: 'A new transitive dependency entered the tree.',
    check({ change }) {
        if (change.kind !== 'added' || change.pkg.direct) return null;

        return { evidence: `new transitive dependency at ${change.pkg.path}` };
    },
};

export default rule;
