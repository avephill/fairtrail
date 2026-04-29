import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { NextRequest } from 'next/server';
import { apiError, apiSuccess } from '@/lib/api-response';
import type { ParseRunRequestPayload } from '@/lib/parse-run';
import { prisma } from '@/lib/prisma';
import { executeParseRun } from './parse-run-job';

const PARSE_RUN_TTL_MS = 24 * 60 * 60 * 1000;
const PARSE_ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const ACTIVE_PARSE_STATUSES = ['pending', 'running'] as const;
const TERMINAL_PARSE_STATUSES = ['completed', 'failed'] as const;
const PARSE_TIMEOUT_ERROR = 'Parse run timed out before completing';

function buildParseQueryHash(rawInput: string, conversationHistory?: ParseRunRequestPayload['conversationHistory']): string {
  return createHash('sha256')
    .update(JSON.stringify({ query: rawInput, conversationHistory: conversationHistory ?? null }))
    .digest('hex');
}

async function cleanupExpiredParseRuns(now = new Date()) {
  await prisma.parseRun.deleteMany({
    where: {
      status: { in: [...TERMINAL_PARSE_STATUSES] },
      expiresAt: { lt: now },
    },
  });
}

async function markStaleParseRunsFailed(queryHash?: string, now = new Date()) {
  const staleBefore = new Date(now.getTime() - PARSE_ACTIVE_TIMEOUT_MS);
  await prisma.parseRun.updateMany({
    where: {
      status: { in: [...ACTIVE_PARSE_STATUSES] },
      updatedAt: { lt: staleBefore },
      ...(queryHash ? { queryHash } : {}),
    },
    data: {
      status: 'failed',
      error: PARSE_TIMEOUT_ERROR,
    },
  });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.query || typeof body.query !== 'string') {
    return apiError('Missing or invalid "query" field', 400);
  }

  const rawInput = body.query.trim();
  if (rawInput.length < 5 || rawInput.length > 500) {
    return apiError('Query must be between 5 and 500 characters', 400);
  }

  const conversationHistory = Array.isArray(body.conversationHistory)
    ? (body.conversationHistory as ParseRunRequestPayload['conversationHistory'])
    : undefined;

  const queryHash = buildParseQueryHash(rawInput, conversationHistory);
  const now = new Date();

  await cleanupExpiredParseRuns(now);
  await markStaleParseRunsFailed(queryHash, now);

  const existingRun = await prisma.parseRun.findFirst({
    where: {
      queryHash,
      status: { in: [...ACTIVE_PARSE_STATUSES] },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (existingRun) {
    return apiSuccess(
      {
        parseRunId: existingRun.id,
        status: existingRun.status,
        expiresAt: existingRun.expiresAt.toISOString(),
      },
      202,
    );
  }

  const requestPayload: ParseRunRequestPayload = {
    query: rawInput,
    ...(conversationHistory?.length ? { conversationHistory } : {}),
  };

  const parseRun = await prisma.parseRun.create({
    data: {
      queryHash,
      status: 'pending',
      requestPayload: requestPayload as unknown as Prisma.InputJsonValue,
      expiresAt: new Date(now.getTime() + PARSE_RUN_TTL_MS),
    },
  });

  void executeParseRun(parseRun.id);

  return apiSuccess(
    {
      parseRunId: parseRun.id,
      status: parseRun.status,
      expiresAt: parseRun.expiresAt.toISOString(),
    },
    202,
  );
}
