import { prisma } from '@/lib/prisma';
import { apiSuccess, apiError } from '@/lib/api-response';
import { isValidIATA } from '@/lib/iata-codes';
import { redis } from '@/lib/redis';

const MAX_BATCH_SIZE = 1000;
const RATE_LIMIT_WINDOW = 3600; // 1 hour per API key

interface IngestSnapshot {
  origin: string;
  destination: string;
  travelDate: string;
  price: number;
  currency: string;
  airline: string;
  stops: number;
  cabinClass: string;
  scrapedAt: string;
}

async function checkRateLimit(apiKeyId: string): Promise<boolean> {
  if (!redis) return true;
  const key = `community:ingest:${apiKeyId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, RATE_LIMIT_WINDOW);
    return count <= 1; // 1 request per hour per key
  } catch {
    return true;
  }
}

export async function POST(request: Request) {
  // Authenticate via Bearer token
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return apiError('Missing authorization', 401);
  }

  const token = authHeader.slice(7);
  const apiKeyRecord = await prisma.communityApiKey.findUnique({
    where: { apiKey: token },
  });

  if (!apiKeyRecord || !apiKeyRecord.active) {
    return apiError('Invalid or revoked API key', 401);
  }

  // Rate limit
  const allowed = await checkRateLimit(apiKeyRecord.id);
  if (!allowed) {
    return apiError('Rate limit exceeded. Max 1 request per hour.', 429);
  }

  const body = await request.json().catch(() => null);
  if (!body || !Array.isArray(body.snapshots)) {
    return apiError('Invalid payload: expected { snapshots: [...] }', 400);
  }

  const snapshots = body.snapshots as IngestSnapshot[];
  if (snapshots.length > MAX_BATCH_SIZE) {
    return apiError(`Batch too large. Max ${MAX_BATCH_SIZE} snapshots.`, 400);
  }

  const now = new Date();
  const valid: {
    origin: string;
    destination: string;
    travelDate: Date;
    price: number;
    currency: string;
    airline: string;
    stops: number;
    cabinClass: string;
    scrapedAt: Date;
    apiKeyId: string;
  }[] = [];
  const errors: string[] = [];

  for (let i = 0; i < snapshots.length; i++) {
    const s = snapshots[i]!;

    // Validate fields
    if (!isValidIATA(s.origin)) { errors.push(`[${i}] invalid origin: ${s.origin}`); continue; }
    if (!isValidIATA(s.destination)) { errors.push(`[${i}] invalid destination: ${s.destination}`); continue; }
    if (typeof s.price !== 'number' || s.price <= 0 || s.price > 50000) { errors.push(`[${i}] invalid price: ${s.price}`); continue; }
    if (typeof s.stops !== 'number' || s.stops < 0 || s.stops > 5) { errors.push(`[${i}] invalid stops: ${s.stops}`); continue; }

    const scrapedAt = new Date(s.scrapedAt);
    if (isNaN(scrapedAt.getTime()) || scrapedAt > now) { errors.push(`[${i}] invalid scrapedAt`); continue; }

    const travelDate = new Date(s.travelDate);
    if (isNaN(travelDate.getTime())) { errors.push(`[${i}] invalid travelDate`); continue; }

    if (typeof s.airline !== 'string' || s.airline.length === 0 || s.airline.length > 100) { errors.push(`[${i}] invalid airline`); continue; }

    valid.push({
      origin: s.origin,
      destination: s.destination,
      travelDate,
      price: s.price,
      currency: typeof s.currency === 'string' ? s.currency.toUpperCase().slice(0, 3) : 'USD',
      airline: s.airline.slice(0, 100),
      stops: s.stops,
      cabinClass: typeof s.cabinClass === 'string' ? s.cabinClass : 'economy',
      scrapedAt,
      apiKeyId: apiKeyRecord.id,
    });
  }

  if (valid.length > 0) {
    await prisma.communitySnapshot.createMany({ data: valid });

    // Update API key stats
    await prisma.communityApiKey.update({
      where: { id: apiKeyRecord.id },
      data: {
        lastSeenAt: now,
        snapshotCount: { increment: valid.length },
      },
    });
  }

  return apiSuccess({
    accepted: valid.length,
    rejected: errors.length,
    errors: errors.slice(0, 10), // Only return first 10 errors
  });
}
