import type { Rule } from './types';

/**
 * `_npmUser` on a version document is frozen at publish time, so comparing base against head asks
 * exactly the right question: did a different account push this version? That is the event-stream
 * signature, and it survives the package changing hands afterwards.
 */
const rule: Rule = {
    id: 'publisher-changed',
    severity: 'high',
    needsNetwork: true,
    description: 'A different npm account published the new version.',
    needs: { metadata: true },
    check({ change, base, head }) {
        if (change.kind !== 'version-changed' || base === null || head === null) return null;

        const from = base.npmUser;
        const to = head.npmUser;

        if (from === undefined || to === undefined || from === to) return null;

        return { evidence: `published by ${to}, previous version by ${from}` };
    },
};

export default rule;
