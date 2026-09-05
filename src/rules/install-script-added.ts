import type { Rule } from './types';

const LIFECYCLE = ['preinstall', 'install', 'postinstall'] as const;

/**
 * The evidence is the command itself, not the fact that a command exists — `postinstall: node
 * install.js` is a second of review, "has an install script" is a research task. That is also the
 * anti-noise mechanism: prebuilt binaries look like prebuilt binaries.
 */
const rule: Rule = {
    id: 'install-script-added',
    severity: 'high',
    needsNetwork: true,
    description: 'A version runs an install script the previous version did not.',
    needs: { metadata: true },
    check({ change, base, head }) {
        if (head === null) return null;
        if (change.kind !== 'added' && change.kind !== 'version-changed') return null;

        const added = LIFECYCLE.map(name => [name, head.scripts?.[name]] as const)
            .filter(([name, command]) => command !== undefined && base?.scripts?.[name] !== command)
            .map(([name, command]) => `${name}: ${command}`);

        return added.length === 0 ? null : { evidence: added.join('; ') };
    },
};

export default rule;
