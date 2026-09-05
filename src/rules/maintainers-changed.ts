import type { Rule } from './types';

/**
 * Gaining a collaborator is routine; losing the owner is not. Both are reported, at `medium`, with
 * the direction spelled out so the difference is visible without opening npm.
 */
const rule: Rule = {
    id: 'maintainers-changed',
    severity: 'medium',
    needsNetwork: true,
    description: 'The maintainer list changed between the two versions.',
    needs: { metadata: true },
    check({ change, base, head }) {
        if (change.kind !== 'version-changed' || base === null || head === null) return null;

        const from = base.maintainers;
        const to = head.maintainers;

        if (from === undefined || to === undefined) return null;

        const gained = to.filter(name => !from.includes(name));
        const lost = from.filter(name => !to.includes(name));

        if (gained.length === 0 && lost.length === 0) return null;

        const parts = [
            ...(lost.length === 0 ? [] : [`no longer maintained by ${lost.join(', ')}`]),
            ...(gained.length === 0 ? [] : [`now also maintained by ${gained.join(', ')}`]),
        ];

        return { evidence: parts.join('; ') };
    },
};

export default rule;
