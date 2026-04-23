import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/prisma', () => ({
  prisma: {
    parseRun: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '@/lib/prisma';
import { GET } from './route';

describe('GET /api/parse/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 404 when run does not exist', async () => {
    vi.mocked(prisma.parseRun.findUnique).mockResolvedValue(null);

    const res = await GET(new Request('http://localhost/api/parse/x'), {
      params: Promise.resolve({ id: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  it('returns completed payload', async () => {
    vi.mocked(prisma.parseRun.findUnique).mockResolvedValue({
      id: 'r1',
      status: 'completed',
      resultPayload: { parsed: null, confidence: 'low', ambiguities: [], dateSpanDays: 0 },
      error: null,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      updatedAt: new Date(),
    } as never);

    const res = await GET(new Request('http://localhost/api/parse/r1'), {
      params: Promise.resolve({ id: 'r1' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.status).toBe('completed');
    expect(body.data.result).toEqual({
      parsed: null,
      confidence: 'low',
      ambiguities: [],
      dateSpanDays: 0,
    });
  });
});
