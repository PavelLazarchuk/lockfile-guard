import { describe, expect, it } from 'vitest';
import { mapLimit } from '../../src/enricher/limit';

describe('mapLimit', () => {
    it('keeps results in input order', async () => {
        const results = await mapLimit([3, 1, 2], 2, async value => {
            await new Promise(resolve => setTimeout(resolve, value));

            return value * 10;
        });

        expect(results).toEqual([30, 10, 20]);
    });

    it('never runs more than the limit at once', async () => {
        let inFlight = 0;
        let peak = 0;

        await mapLimit(
            Array.from({ length: 20 }, (_, i) => i),
            4,
            async () => {
                inFlight += 1;
                peak = Math.max(peak, inFlight);
                await new Promise(resolve => setTimeout(resolve, 1));
                inFlight -= 1;
            }
        );

        expect(peak).toBe(4);
    });

    it('handles an empty list and a nonsense limit', async () => {
        expect(await mapLimit([], 8, async () => 1)).toEqual([]);
        expect(await mapLimit([1], 0, async value => value)).toEqual([1]);
    });
});
