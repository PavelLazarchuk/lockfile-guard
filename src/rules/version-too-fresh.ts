import { hoursSince } from '../enricher/freshness';
import type { Rule } from './types';

/**
 * A version published minutes ago has had no time to be noticed. This is a wait-a-day signal, not
 * an accusation, which is why it is `medium` and why the age is stated rather than implied.
 */
const rule: Rule = {
    id: 'version-too-fresh',
    severity: 'medium',
    needsNetwork: true,
    description: 'The new version was published very recently.',
    needs: { metadata: true, freshness: true },
    check({ head }, config) {
        if (head?.publishedAt === undefined) return null;

        const age = hoursSince(head.publishedAt, Date.now());
        if (age === undefined || age >= config.freshnessHours) return null;

        return {
            evidence: `published ${formatAge(age)} ago (${head.publishedAt}), threshold is ${config.freshnessHours}h`,
        };
    },
};

function formatAge(hours: number): string {
    return hours < 1 ? `${Math.max(1, Math.round(hours * 60))}m` : `${Math.round(hours)}h`;
}

export default rule;
