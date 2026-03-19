import Transport from 'winston-transport';

export interface LogEntry {
  level: string;
  message: string;
  timestamp?: string;
}

const MAX_BUFFER_SIZE = 500;

class AgentLogBuffer {
  private buffer: LogEntry[] = [];

  push(entry: LogEntry): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      this.buffer.shift(); // drop oldest
    }
    this.buffer.push(entry);
  }

  /** Re-buffer a list of entries (e.g. after a failed POST). Respects the 500-entry cap. */
  pushAll(entries: LogEntry[]): void {
    for (const e of entries) {
      this.push(e);
    }
  }

  /** Returns all buffered entries and clears the buffer. */
  drain(): LogEntry[] {
    const entries = [...this.buffer];
    this.buffer = [];
    return entries;
  }

  /** Clears the buffer (discard all entries). */
  flush(): void {
    this.buffer = [];
  }

  /** FOR TESTS ONLY: directly replace buffer contents. */
  seed(entries: LogEntry[]): void {
    this.buffer = [...entries];
  }

  get size(): number {
    return this.buffer.length;
  }
}

export const agentLogBuffer = new AgentLogBuffer();

export class AgentTransport extends Transport {
  log(info: any, callback: () => void): void {
    agentLogBuffer.push({
      level: info.level,
      message: info.message,
      timestamp: info.timestamp || new Date().toISOString(),
    });
    callback();
  }
}
