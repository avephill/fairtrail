import { apiError, apiSuccess } from '@/lib/api-response';
import type { ParseRunStatusPayload } from '@/lib/parse-run';
import { prisma } from '@/lib/prisma';
import type { ParseResponse } from '@/lib/scraper/parse-query';

const PARSE_ACTIVE_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINAL_PARSE_STATUSES = new Set(['completed', 'failed']);
const ACTIVE_PARSE_STATUSES = new Set(['pending', 'running']);
const PARSE_TIMEOUT_ERROR = 'Parse run timed out before completing';

function isExpired(expiresAt: Date): boolean {
  return expiresAt.getTime() <= Date.now();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const notFound = () => {
    const response = apiError('Parse run not found or expired', 404);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    return response;
  };

  const { id } = await context.params;

  let parseRun = await prisma.parseRun.findUnique({
    where: { id },
  });

  if (!parseRun) {
    return notFound();
  }

  if (
    ACTIVE_PARSE_STATUSES.has(parseRun.status) &&
    parseRun.updatedAt.getTime() <= Date.now() - PARSE_ACTIVE_TIMEOUT_MS
  ) {
    parseRun = await prisma.parseRun.update({
      where: { id },
      data: {
        status: 'failed',
        error: PARSE_TIMEOUT_ERROR,
      },
    });
  }

  if (TERMINAL_PARSE_STATUSES.has(parseRun.status) && isExpired(parseRun.expiresAt)) {
    return notFound();
  }

  const response: ParseRunStatusPayload = {
    id: parseRun.id,
    status: parseRun.status as ParseRunStatusPayload['status'],
    result: parseRun.resultPayload as ParseResponse | null,
    error: parseRun.error,
    expiresAt: parseRun.expiresAt.toISOString(),
  };

  const apiResponse = apiSuccess(response);
  apiResponse.headers.set('Cache-Control', 'private, no-store, max-age=0');
  return apiResponse;
}
