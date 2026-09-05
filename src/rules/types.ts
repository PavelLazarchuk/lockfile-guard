import type { Config } from '../config';
import type { Needs } from '../enricher';
import type { EnrichedChange, Severity } from '../model';

export type RuleResult = { evidence: string };

export type Rule = {
    id: string;
    severity: Severity;
    needsNetwork: boolean;
    description: string;
    needs?: Partial<Needs>;
    check(input: EnrichedChange, config: Config): RuleResult | null;
};
