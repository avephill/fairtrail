import { prisma } from '@/lib/prisma';
import { apiSuccess } from '@/lib/api-response';
import { cached } from '@/lib/redis';

interface RouteInfo {
  origin: string;
  destination: string;
  snapshotCount: number;
  avgPrice: number;
  minPrice: number;
  maxPrice: number;
  airlines: string[];
  latestScrapedAt: string;
}

export async function GET() {
  const routes = await cached('community:routes', async () => {
    const raw = await prisma.communitySnapshot.groupBy({
      by: ['origin', 'destination'],
      _count: { id: true },
      _avg: { price: true },
      _min: { price: true },
      _max: { price: true },
      orderBy: { _count: { id: 'desc' } },
      take: 200,
    });

    const result: RouteInfo[] = [];

    for (const r of raw) {
      // Get airlines and latest scrape for this route
      const details = await prisma.communitySnapshot.findMany({
        where: { origin: r.origin, destination: r.destination },
        select: { airline: true, scrapedAt: true },
        distinct: ['airline'],
        orderBy: { scrapedAt: 'desc' },
        take: 20,
      });

      const latest = await prisma.communitySnapshot.findFirst({
        where: { origin: r.origin, destination: r.destination },
        orderBy: { scrapedAt: 'desc' },
        select: { scrapedAt: true },
      });

      result.push({
        origin: r.origin,
        destination: r.destination,
        snapshotCount: r._count.id,
        avgPrice: Math.round(r._avg.price ?? 0),
        minPrice: r._min.price ?? 0,
        maxPrice: r._max.price ?? 0,
        airlines: details.map((d: { airline: string }) => d.airline),
        latestScrapedAt: latest?.scrapedAt.toISOString() ?? '',
      });
    }

    return result;
  }, 300);

  return apiSuccess(routes);
}
