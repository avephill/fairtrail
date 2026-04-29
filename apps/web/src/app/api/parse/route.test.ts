import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('./parse-run-job', () => ({
  executeParseRun: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    parseRun: {
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({
        id: 'run_test_1',
        status: 'pending',
        expiresAt: new Date('2099-01-01T00:00:00.000Z'),
      }),
    },
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn().mockResolvedValue({ get: vi.fn(), set: vi.fn(), delete: vi.fn() }),
}));

import { prisma } from '@/lib/prisma';
import { executeParseRun } from './parse-run-job';
import { POST } from './route';

function makeRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/parse', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/parse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.parseRun.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.parseRun.create).mockResolvedValue({
      id: 'run_test_1',
      status: 'pending',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);
  });

  it('rejects missing query field with 400', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it('rejects query shorter than 5 chars with 400', async () => {
    const res = await POST(makeRequest({ query: 'ab' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('between 5 and 500');
  });

  it('rejects query longer than 500 chars with 400', async () => {
    const res = await POST(makeRequest({ query: 'a'.repeat(501) }));
    expect(res.status).toBe(400);
  });

  it('returns 202 with parseRunId and schedules executeParseRun', async () => {
    const res = await POST(makeRequest({ query: 'JFK to LAX June 15-22' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.parseRunId).toBe('run_test_1');
    expect(body.data.status).toBe('pending');
    expect(prisma.parseRun.create).toHaveBeenCalled();
    expect(executeParseRun).toHaveBeenCalledWith('run_test_1');
  });

  it('returns existing run when same query is already in flight', async () => {
    vi.mocked(prisma.parseRun.findFirst).mockResolvedValue({
      id: 'existing',
      status: 'running',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    } as never);

    const res = await POST(makeRequest({ query: 'JFK to LAX June 15-22' }));
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.data.parseRunId).toBe('existing');
    expect(prisma.parseRun.create).not.toHaveBeenCalled();
  });
});
