import { apiSuccess } from '@/lib/api-response';
import { prisma } from '@/lib/prisma';
import { getCronInfo } from '@/lib/cron';

export const dynamic = 'force-dynamic';

export async function GET() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [activeQueries, totalScrapes, totalPricePoints, costResult] = await Promise.all([
    prisma.query.count({
      where: { active: true, isSeed: false, expiresAt: { gt: new Date() } },
    }),
    prisma.fetchRun.count(),
    prisma.priceSnapshot.count(),
    prisma.apiUsageLog.aggregate({
      _sum: { costUsd: true },
      where: { createdAt: { gte: thirtyDaysAgo } },
    }),
  ]);

  const cron = getCronInfo();

  return apiSuccess({
    activeQueries,
    totalScrapes,
    totalPricePoints,
    llmCost30d: Math.round((costResult._sum.costUsd ?? 0) * 100) / 100,
    cron,
  });
}
