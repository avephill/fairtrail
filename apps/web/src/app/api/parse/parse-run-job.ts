import type { Prisma } from '@prisma/client';
import type { ParseRunRequestPayload } from '@/lib/parse-run';
import { prisma } from '@/lib/prisma';
import { parseFlightQuery } from '@/lib/scraper/parse-query';

export async function executeParseRun(id: string) {
  try {
    await prisma.parseRun.update({
      where: { id },
      data: { status: 'running' },
    });

    const run = await prisma.parseRun.findUnique({ where: { id } });
    if (!run) return;

    const payload = run.requestPayload as unknown as ParseRunRequestPayload;
    const { response, usage } = await parseFlightQuery(payload.query, payload.conversationHistory);

    const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
    await prisma.apiUsageLog.create({
      data: {
        provider: config?.provider ?? 'anthropic',
        model: config?.model ?? 'claude-haiku-4-5-20251001',
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costUsd: 0,
        operation: 'parse-query',
        durationMs: 0,
      },
    });

    await prisma.parseRun.update({
      where: { id },
      data: {
        status: 'completed',
        resultPayload: response as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to parse query';
    await prisma.parseRun.update({
      where: { id },
      data: { status: 'failed', error: msg },
    }).catch(() => {});
  }
}
