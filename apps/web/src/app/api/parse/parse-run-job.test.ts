import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockParseFlightQuery = vi.fn();

vi.mock('@/lib/scraper/parse-query', () => ({
  parseFlightQuery: (...args: unknown[]) => mockParseFlightQuery(...args),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    parseRun: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
    },
    extractionConfig: { findFirst: vi.fn().mockResolvedValue(null) },
    apiUsageLog: { create: vi.fn().mockResolvedValue({}) },
  },
}));

import { prisma } from '@/lib/prisma';
import { executeParseRun } from './parse-run-job';

describe('executeParseRun', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseFlightQuery.mockReset();
  });

  it('marks completed and logs usage on success', async () => {
    vi.mocked(prisma.parseRun.findUnique).mockResolvedValue({
      id: 'r1',
      requestPayload: { query: 'JFK to LAX June 15' },
    } as never);

    mockParseFlightQuery.mockResolvedValue({
      response: { parsed: null, confidence: 'low', ambiguities: [], dateSpanDays: 0 },
      usage: { inputTokens: 10, outputTokens: 20 },
    });

    await executeParseRun('r1');

    expect(prisma.parseRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'running' }),
      }),
    );
    expect(prisma.apiUsageLog.create).toHaveBeenCalled();
    expect(prisma.parseRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'completed' }),
      }),
    );
  });

  it('marks failed when parse throws', async () => {
    vi.mocked(prisma.parseRun.findUnique).mockResolvedValue({
      id: 'r1',
      requestPayload: { query: 'JFK to LAX June 15' },
    } as never);

    mockParseFlightQuery.mockRejectedValue(new Error('LLM exploded'));

    await executeParseRun('r1');

    expect(prisma.parseRun.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'r1' },
        data: expect.objectContaining({ status: 'failed', error: 'LLM exploded' }),
      }),
    );
  });
});
