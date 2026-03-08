import { apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { hasValidInvite } from '@/lib/invite-auth';

export const dynamic = 'force-dynamic';

export async function GET() {
  if (!(await hasValidInvite())) {
    return apiSuccess({ queries: [] });
  }

  const queries = await prisma.query.findMany({
    where: {
      active: true,
      isSeed: false,
      OR: [{ expiresAt: { gt: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      origin: true,
      destination: true,
      originName: true,
      destinationName: true,
      dateFrom: true,
      dateTo: true,
      scrapeInterval: true,
      createdAt: true,
      expiresAt: true,
      groupId: true,
      fetchRuns: {
        orderBy: { startedAt: 'desc' },
        take: 1,
        select: { startedAt: true },
      },
      _count: {
        select: { snapshots: true },
      },
    },
  });

  const result = queries.map((q) => ({
    id: q.id,
    origin: q.origin,
    destination: q.destination,
    originName: q.originName,
    destinationName: q.destinationName,
    dateFrom: q.dateFrom.toISOString().split('T')[0],
    dateTo: q.dateTo.toISOString().split('T')[0],
    scrapeInterval: q.scrapeInterval,
    snapshotCount: q._count.snapshots,
    lastScrapedAt: q.fetchRuns[0]?.startedAt.toISOString() ?? null,
    groupId: q.groupId,
    createdAt: q.createdAt.toISOString(),
  }));

  return apiSuccess({ queries: result });
}
