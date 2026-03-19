import { AgentTransport, agentLogBuffer } from '../agentTransport';
import Transport from 'winston-transport';

describe('AgentTransport', () => {
  beforeEach(() => {
    agentLogBuffer.flush();
  });

  it('is a Winston transport', () => {
    const t = new AgentTransport();
    expect(t).toBeInstanceOf(Transport);
  });

  it('adds log entries to the buffer', () => {
    const t = new AgentTransport();
    const callback = jest.fn();
    t.log({ level: 'info', message: 'hello' }, callback);
    const entries = agentLogBuffer.drain();
    expect(entries).toHaveLength(1);
    expect(entries[0].level).toBe('info');
    expect(entries[0].message).toBe('hello');
    expect(callback).toHaveBeenCalled();
  });

  it('drops oldest entries when buffer exceeds 500', () => {
    const t = new AgentTransport();
    for (let i = 0; i < 501; i++) {
      t.log({ level: 'info', message: `msg-${i}` }, () => {});
    }
    const entries = agentLogBuffer.drain();
    expect(entries).toHaveLength(500);
    expect(entries[0].message).toBe('msg-1'); // msg-0 dropped
    expect(entries[499].message).toBe('msg-500');
  });

  it('drain returns entries and empties buffer', () => {
    const t = new AgentTransport();
    t.log({ level: 'warn', message: 'test' }, () => {});
    const first = agentLogBuffer.drain();
    const second = agentLogBuffer.drain();
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it('flush clears buffer without returning entries', () => {
    const t = new AgentTransport();
    t.log({ level: 'error', message: 'oops' }, () => {});
    agentLogBuffer.flush();
    expect(agentLogBuffer.drain()).toHaveLength(0);
  });

  it('pushAll re-buffers entries respecting the 500-entry cap', () => {
    for (let i = 0; i < 490; i++) {
      agentLogBuffer.push({ level: 'info', message: `existing-${i}` });
    }
    const toRebuffer = Array.from({ length: 20 }, (_, i) => ({
      level: 'info',
      message: `rebuffer-${i}`,
      timestamp: '2026-01-01',
    }));
    agentLogBuffer.pushAll(toRebuffer);
    expect(agentLogBuffer.size).toBe(500);
  });

  it('seed directly sets buffer contents (test helper)', () => {
    agentLogBuffer.seed([{ level: 'info', message: 'seeded', timestamp: '2026-01-01' }]);
    expect(agentLogBuffer.size).toBe(1);
    const entries = agentLogBuffer.drain();
    expect(entries[0].message).toBe('seeded');
  });
});
