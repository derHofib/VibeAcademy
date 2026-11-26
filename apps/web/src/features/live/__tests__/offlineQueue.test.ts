import { enqueueScan, flushScans, QUEUE_KEY, readQueue, type KeyValueStore, type QueuedScan } from '../offlineQueue';

function memoryStore(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

const now = Date.parse('2026-12-04T12:00:00Z');
const scan = (token: string, kind: 'start' | 'end' = 'start', minutesAgo = 1) => ({
  kind,
  token,
  deviceTime: new Date(now - minutesAgo * 60_000).toISOString(),
  invitationId: 'inv',
});

describe('Offline-Warteschlange für Scans', () => {
  it('speichert Scans (je Token einmal) und liest robust', () => {
    const s = memoryStore();
    enqueueScan(s, scan('a'), '1');
    enqueueScan(s, scan('b', 'end'), '2');
    enqueueScan(s, scan('a'), '3');
    expect(readQueue(s).map((x) => [x.token, x.kind])).toEqual([
      ['b', 'end'],
      ['a', 'start'],
    ]);
    s.setItem(QUEUE_KEY, '{kaputt');
    expect(readQueue(s)).toEqual([]);
    s.setItem(QUEUE_KEY, JSON.stringify([{ token: 'x', kind: 'falsch' }, { token: 'y', kind: 'end', deviceTime: '', id: '1', invitationId: null }]));
    expect(readQueue(s).map((x) => x.token)).toEqual(['y']);
    expect(readQueue(null)).toEqual([]);
  });

  it('sendet der Reihe nach mit, verwirft Abgelehntes und behält bei Netzfehler den Rest', async () => {
    const s = memoryStore();
    enqueueScan(s, scan('a'), '1');
    enqueueScan(s, scan('b', 'end'), '2');
    enqueueScan(s, scan('c'), '3');
    const sent: QueuedScan[] = [];
    const report = await flushScans(
      s,
      async (x) => {
        sent.push(x);
        if (x.token === 'a') return { result: 'ok' };
        if (x.token === 'b') return { result: 'rejected', message: 'Der QR-Code ist abgelaufen.' };
        return { result: 'network' };
      },
      now,
    );
    expect(sent.map((x) => x.token)).toEqual(['a', 'b', 'c']);
    expect(report.sent.map((x) => x.token)).toEqual(['a']);
    expect(report.rejected).toEqual([{ scan: expect.objectContaining({ token: 'b' }), message: 'Der QR-Code ist abgelaufen.' }]);
    expect(report.remaining.map((x) => x.token)).toEqual(['c']);
    expect(readQueue(s).map((x) => x.token)).toEqual(['c']);
    // zweiter Versuch, jetzt online
    const r2 = await flushScans(s, async () => ({ result: 'ok' }), now);
    expect(r2.sent.map((x) => x.token)).toEqual(['c']);
    expect(s.data.has(QUEUE_KEY)).toBe(false);
  });

  it('verwirft Scans, die älter als 12 Stunden sind, ohne sie zu senden', async () => {
    const s = memoryStore();
    enqueueScan(s, scan('alt', 'start', 13 * 60), '1');
    const send = vi.fn(async () => ({ result: 'ok' as const }));
    const r = await flushScans(s, send, now);
    expect(send).not.toHaveBeenCalled();
    expect(r.rejected).toHaveLength(1);
    expect(readQueue(s)).toEqual([]);
  });
});
