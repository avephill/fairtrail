import { prisma } from '@/lib/prisma';
import { apiSuccess, apiError } from '@/lib/api-response';
import { cached } from '@/lib/redis';
import { isValidIATA } from '@/lib/iata-codes';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ route: string }> }
) {
  const { route } = await params;
  const parts = route.split('-');

  if (parts.length !== 2) {
    return apiError('Route must be formatted as ORIGIN-DESTINATION (e.g., JFK-CDG)', 400);
  }

  const [origin, destination] = parts as [string, string];

  if (!isValidIATA(origin) || !isValidIATA(destination)) {
    return apiError('Invalid IATA airport codes', 400);
  }

  const prices = await cached(`community:route:${origin}-${destination}`, async () => {
    const snapshots = await prisma.communitySnapshot.findMany({
      where: { origin, destination },
      select: {
        travelDate: true,
        price: true,
        currency: true,
        airline: true,
        stops: true,
        cabinClass: true,
        scrapedAt: true,
      },
      orderBy: { scrapedAt: 'asc' },
      take: 5000,
    });

    return snapshots.map((s: typeof snapshots[number]) => ({
      travelDate: s.travelDate.toISOString().split('T')[0],
      price: s.price,
      currency: s.currency,
      airline: s.airline,
      stops: s.stops,
      cabinClass: s.cabinClass,
      scrapedAt: s.scrapedAt.toISOString(),
    }));
  }, 300);

  return apiSuccess({ origin, destination, prices });
}
