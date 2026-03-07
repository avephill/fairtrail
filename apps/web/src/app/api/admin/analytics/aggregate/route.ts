import { NextRequest } from 'next/server';
import { aggregateDay, cleanupOldEvents, cleanupOldSalts } from '@/lib/analytics/aggregate';
import { apiSuccess } from '@/lib/api-response';

export async function POST(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const date = searchParams.get('date') || undefined;

  const { aggregated, eventsProcessed, suspectedBots } = aggregateDay(date);
  const deletedEvents = cleanupOldEvents();
  const deletedSalts = cleanupOldSalts();

  return apiSuccess({
    aggregation: { aggregated, eventsProcessed, suspectedBots },
    cleanup: { deletedEvents, deletedSalts },
  });
}
