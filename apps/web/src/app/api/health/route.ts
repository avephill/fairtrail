import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = 'connected';
  } catch {
    checks.database = 'error';
  }

  if (redis) {
    try {
      await redis.ping();
      checks.redis = 'connected';
    } catch {
      checks.redis = 'error';
    }
  } else {
    checks.redis = 'disabled';
  }

  const healthy =
    checks.database === 'connected' &&
    (checks.redis === 'connected' || checks.redis === 'disabled');

  return Response.json(
    { status: healthy ? 'ok' : 'degraded', ...checks },
    { status: healthy ? 200 : 503 }
  );
}
