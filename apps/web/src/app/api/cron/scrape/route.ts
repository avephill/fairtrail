import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { runScrapeAll, cleanupUnvisitedQueries } from '@/lib/scraper/run-scrape';

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;

  if (!authHeader || authHeader !== expected) {
    return apiError('Unauthorized', 401);
  }

  // Legacy safety cleanup: remove orphaned queries that were never viewed.
  // Newly created trackers now set firstViewedAt immediately, so this should
  // typically delete 0 rows unless a write failed mid-request.
  const deletedUnvisited = await cleanupUnvisitedQueries();

  let results;
  try {
    results = await runScrapeAll();
  } catch (err) {
    if (err instanceof Error && err.message === 'Scrape already in progress') {
      return apiError('Scrape already in progress', 409);
    }
    throw err;
  }

  const summary = {
    deletedUnvisited,
    queriesProcessed: results.length,
    successful: results.filter((r) => r.status === 'success').length,
    partial: results.filter((r) => r.status === 'partial').length,
    failed: results.filter((r) => r.status === 'failed').length,
    totalSnapshots: results.reduce((sum, r) => sum + r.snapshotsCount, 0),
    totalCost: results.reduce((sum, r) => sum + r.extractionCost, 0),
    results,
  };

  return apiSuccess(summary);
}
