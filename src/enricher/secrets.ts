/**
 * A registry token must never reach a PR comment, and error messages from `fetch` happily quote the
 * URL they failed on. Every string that leaves the network layer goes through here first.
 */
const PATTERNS: RegExp[] = [
    /(_auth(?:Token)?\s*=\s*)\S+/gi,
    /(authorization\s*:\s*\w+\s+)\S+/gi,
    /(\b(?:token|api[-_]?key|access[-_]?token)=)[^&\s"']+/gi,
    /(https?:\/\/)[^/\s:@]+:[^/\s@]+@/gi,
];

export const REDACTED = '***';

export function redact(text: string, extra: readonly string[] = []): string {
    let output = text;

    for (const secret of extra)
        if (secret.length >= 8) output = output.split(secret).join(REDACTED);

    for (const pattern of PATTERNS)
        output = output.replace(pattern, (match, prefix: string) =>
            match.endsWith('@') ? `${prefix}${REDACTED}@` : `${prefix}${REDACTED}`
        );

    return output;
}

/** Errors are the usual carrier — `fetch failed` wraps a cause that quotes the request URL. */
export function redactError(error: unknown, extra: readonly string[] = []): string {
    const message = error instanceof Error ? error.message : String(error);
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : '';

    return redact(cause === '' ? message : `${message}: ${cause}`, extra);
}
