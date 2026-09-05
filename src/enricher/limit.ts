/**
 * Twenty lines instead of a dependency: run `tasks` with at most `concurrency` in flight, keeping
 * results in input order. Nothing here rejects — the caller decides what a failed task means.
 */
export async function mapLimit<T, R>(
    items: readonly T[],
    concurrency: number,
    task: (item: T, index: number) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    const workers = Math.max(1, Math.min(concurrency, items.length));
    let next = 0;

    async function worker(): Promise<void> {
        for (;;) {
            const index = next;
            next += 1;
            if (index >= items.length) return;

            results[index] = await task(items[index] as T, index);
        }
    }

    await Promise.all(Array.from({ length: workers }, worker));

    return results;
}
