import { STICKY_MARKER } from '../reporters/markdown';

export type GithubContext = {
    token: string;
    repo: string;
    prNumber: number;
    apiUrl: string;
};

type IssueComment = { id: number; body?: string };

/** GitHub rejects an issue comment over 65536 characters, and a big pull request gets there. */
const MAX_BODY = 65_536;
const TRUNCATION_NOTICE = '\n\n<sub>Report truncated — too long for a GitHub comment.</sub>\n';

export class GithubError extends Error {}

/**
 * Everything the action needs is already in the environment GitHub hands the step — no event
 * payload parsing, so this works the same when the CLI is run by hand with the vars exported.
 */
export function contextFromEnv(env: NodeJS.ProcessEnv = process.env): GithubContext | null {
    const token = env.GITHUB_TOKEN ?? env.INPUT_TOKEN ?? '';
    const repo = env.GITHUB_REPOSITORY ?? '';
    const prNumber = prNumberFrom(env);

    if (token === '' || repo === '' || prNumber === null) return null;

    return {
        token,
        repo,
        prNumber,
        apiUrl: (env.GITHUB_API_URL ?? 'https://api.github.com').replace(/\/$/, ''),
    };
}

function prNumberFrom(env: NodeJS.ProcessEnv): number | null {
    const explicit = Number.parseInt(env.PR_NUMBER ?? '', 10);
    if (Number.isInteger(explicit) && explicit > 0) return explicit;

    const fromRef = /^refs\/pull\/(\d+)\//.exec(env.GITHUB_REF ?? '');

    return fromRef === null ? null : Number.parseInt(fromRef[1] as string, 10);
}

/**
 * Sticky by HTML marker: one comment per pull request, edited in place. A new comment per push is
 * how a useful bot becomes a muted one.
 */
export async function upsertStickyComment(
    context: GithubContext,
    body: string,
    fetchImpl: typeof fetch = globalThis.fetch,
    { createIfMissing = true }: { createIfMissing?: boolean } = {}
): Promise<{ action: 'created' | 'updated' | 'skipped'; id: number | null }> {
    const existing = await findSticky(context, fetchImpl);

    if (existing === null && !createIfMissing) return { action: 'skipped', id: null };

    const base = `${context.apiUrl}/repos/${context.repo}/issues`;
    const url =
        existing === null
            ? `${base}/${context.prNumber}/comments`
            : `${base}/comments/${existing.id}`;

    const response = await fetchImpl(url, {
        method: existing === null ? 'POST' : 'PATCH',
        headers: headers(context),
        body: JSON.stringify({ body: truncate(body) }),
    });

    if (!response.ok)
        throw new GithubError(
            `GitHub answered ${response.status} ${response.statusText} when writing the comment.`
        );

    const created = (await response.json()) as IssueComment;

    return { action: existing === null ? 'created' : 'updated', id: created.id };
}

async function findSticky(
    context: GithubContext,
    fetchImpl: typeof fetch
): Promise<IssueComment | null> {
    for (let page = 1; page <= 10; page += 1) {
        const url = `${context.apiUrl}/repos/${context.repo}/issues/${context.prNumber}/comments?per_page=100&page=${page}`;
        const response = await fetchImpl(url, { headers: headers(context) });

        if (!response.ok)
            throw new GithubError(
                `GitHub answered ${response.status} ${response.statusText} when listing comments.`
            );

        const body = await response.json();
        if (!Array.isArray(body)) return null;

        const comments = body as IssueComment[];
        const sticky = comments.find(comment => comment.body?.includes(STICKY_MARKER) === true);

        if (sticky !== undefined) return sticky;
        if (comments.length < 100) return null;
    }

    return null;
}

function truncate(body: string): string {
    if (body.length <= MAX_BODY) return body;

    return `${body.slice(0, MAX_BODY - TRUNCATION_NOTICE.length)}${TRUNCATION_NOTICE}`;
}

function headers(context: GithubContext): Record<string, string> {
    return {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${context.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        'user-agent': 'lockfile-guard',
    };
}
