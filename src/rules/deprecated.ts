import type { Rule } from './types';

const rule: Rule = {
    id: 'deprecated',
    severity: 'low',
    needsNetwork: true,
    description: 'The new version is marked deprecated on the registry.',
    needs: { metadata: true },
    check({ change, head }) {
        if (change.kind === 'removed' || head === null) return null;

        const message = head.deprecated;
        if (typeof message !== 'string' || message === '') return null;

        return { evidence: `deprecated: ${message}` };
    },
};

export default rule;
