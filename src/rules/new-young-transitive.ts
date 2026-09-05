import type { Rule } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The honest version of the age question, and the expensive one — it needs `time.created` from a
 * full packument. Off unless `--strict-age` asks for it; `new-obscure-transitive` is the default.
 */
const rule: Rule = {
    id: 'new-young-transitive',
    severity: 'medium',
    needsNetwork: true,
    description: 'A new transitive dependency was first published very recently.',
    needs: { firstPublish: true },
    check({ change, head }, config) {
        if (change.kind !== 'added' || change.pkg.direct) return null;
        if (head?.firstPublishedAt === undefined) return null;

        const created = Date.parse(head.firstPublishedAt);
        if (Number.isNaN(created)) return null;

        const days = (Date.now() - created) / DAY_MS;
        if (days >= config.maxTransitiveAgeDays) return null;

        return {
            evidence: `first published ${Math.max(0, Math.round(days))}d ago (${head.firstPublishedAt}), threshold is ${config.maxTransitiveAgeDays}d`,
        };
    },
};

export default rule;
