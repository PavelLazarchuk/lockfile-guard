import { getGlobalDispatcher, MockAgent, setGlobalDispatcher, type Dispatcher } from 'undici';

/**
 * Every registry test talks to a MockAgent, so the enricher exercises the real fetch path — headers,
 * status codes, ETags — without a single packet leaving the machine.
 */
export function mockRegistry(): { agent: MockAgent; restore: () => void } {
    const original: Dispatcher = getGlobalDispatcher();
    const agent = new MockAgent();

    agent.disableNetConnect();
    setGlobalDispatcher(agent);

    return { agent, restore: () => setGlobalDispatcher(original) };
}
