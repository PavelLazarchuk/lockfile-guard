/**
 * A registry is not always an origin. Artifactory serves npm under
 * `https://art.example.com/artifactory/api/npm/npm-local`, and reducing that to its origin sends
 * requests to the wrong URL and loses the `.npmrc` credential, which is keyed by path prefix. So a
 * registry is kept whole — origin plus path — everywhere it is compared or concatenated.
 */

/** Strips the trailing slash so a registry can be compared and concatenated safely. */
export function normalizeRegistry(url: string): string | null {
    try {
        const parsed = new URL(url);
        const path = parsed.pathname.replace(/\/+$/, '');

        return `${originOf(parsed)}${path}`;
    } catch {
        return null;
    }
}

/**
 * Which registry a resolution came from. An npm tarball URL is `<registry>/<name>/-/<file>.tgz`, so
 * everything before `/<name>/-/` is the registry, path prefix included. Anything else — a git
 * dependency, a download URL that is not shaped like a tarball — falls back to its origin.
 */
export function resolutionRegistry(resolved: string, name: string): string | null {
    const marker = resolved.indexOf(`/${name}/-/`);

    if (marker !== -1) return normalizeRegistry(resolved.slice(0, marker));

    try {
        return originOf(new URL(resolved));
    } catch {
        return null;
    }
}

/** The `/` matters: it is what stops `registry.npmjs.org` from allowing `registry.npmjs.org.evil`. */
export function isAllowedRegistry(registry: string, allowlist: readonly string[]): boolean {
    return allowlist.some(entry => registry === entry || registry.startsWith(`${entry}/`));
}

export function normalizeAll(registries: readonly string[]): string[] {
    return registries
        .map(registry => normalizeRegistry(registry))
        .filter((registry): registry is string => registry !== null);
}

export function isHttpUrl(url: string): boolean {
    return /^https?:\/\//.test(url);
}

/** `URL.origin` is the string `"null"` for every scheme it does not consider special. */
function originOf(parsed: URL): string {
    return parsed.origin === 'null' ? `${parsed.protocol}//${parsed.host}` : parsed.origin;
}
