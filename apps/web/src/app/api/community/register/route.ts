import { prisma } from '@/lib/prisma';
import { apiSuccess, apiError } from '@/lib/api-response';
import { randomBytes } from 'crypto';
import { redis } from '@/lib/redis';

const RATE_LIMIT_WINDOW = 3600; // 1 hour
const RATE_LIMIT_MAX = 5; // max registrations per IP per hour

async function checkRateLimit(ip: string): Promise<boolean> {
  if (!redis) return true;
  const key = `community:register:${ip}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW);
    return count <= RATE_LIMIT_MAX;
  } catch {
    return true; // Redis down — allow through
  }
}

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';

  const allowed = await checkRateLimit(ip);
  if (!allowed) {
    return apiError('Too many registrations. Try again later.', 429);
  }

  const apiKey = `ft_${randomBytes(32).toString('hex')}`;

  await prisma.communityApiKey.create({
    data: { apiKey },
  });

  return apiSuccess({ apiKey });
}
