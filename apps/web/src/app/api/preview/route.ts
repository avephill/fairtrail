import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { cached } from '@/lib/redis';
import { prisma } from '@/lib/prisma';
import { navigateGoogleFlights } from '@/lib/scraper/navigate';
import { extractPrices, type PriceData } from '@/lib/scraper/extract-prices';
import { getModelCosts } from '@/lib/scraper/ai-registry';
import { createHash } from 'crypto';
import { hasValidInvite } from '@/lib/invite-auth';

const PREVIEW_MAX_RESULTS = 20;

function buildCacheKey(params: {
  origin: string;
  destination: string;
  dateFrom: string;
  dateTo: string;
}): string {
  const hash = createHash('sha256')
    .update(`${params.origin}:${params.destination}:${params.dateFrom}:${params.dateTo}`)
    .digest('hex')
    .slice(0, 16);
  return `preview:${hash}`;
}

export async function POST(request: NextRequest) {
  if (!(await hasValidInvite())) {
    return apiError('Invite code required', 401);
  }

  const body = await request.json().catch(() => null);
  if (!body) return apiError('Invalid JSON body', 400);

  const { origin, destination, dateFrom, dateTo, maxPrice, maxStops, preferredAirlines, timePreference, cabinClass } = body;

  if (!origin || !destination || !dateFrom || !dateTo) {
    return apiError('Missing required fields: origin, destination, dateFrom, dateTo', 400);
  }

  if (!/^[A-Z]{3}$/.test(origin) || !/^[A-Z]{3}$/.test(destination)) {
    return apiError('Invalid airport code — must be 3 uppercase letters', 400);
  }

  const from = new Date(dateFrom + 'T00:00:00Z');
  const to = new Date(dateTo + 'T00:00:00Z');

  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    return apiError('Invalid date format', 400);
  }

  if (from >= to) {
    return apiError('dateFrom must be before dateTo', 400);
  }

  const cacheKey = buildCacheKey({ origin, destination, dateFrom, dateTo });

  try {
    const prices = await cached<PriceData[]>(cacheKey, async () => {
      const { html, url, resultsFound } = await navigateGoogleFlights({
        origin,
        destination,
        dateFrom: from,
        dateTo: to,
      });

      const travelDateFallback = dateFrom;
      const filters = {
        maxPrice: maxPrice ? Number(maxPrice) : null,
        maxStops: maxStops !== undefined && maxStops !== null ? Number(maxStops) : null,
        preferredAirlines: Array.isArray(preferredAirlines) ? preferredAirlines : [],
        timePreference: timePreference || 'any',
        cabinClass: cabinClass || 'economy',
      };

      const { prices: extracted, usage, failureReason } = await extractPrices(
        html,
        url,
        travelDateFallback,
        filters,
        PREVIEW_MAX_RESULTS,
        resultsFound
      );

      // Log API usage
      const config = await prisma.extractionConfig.findFirst({ where: { id: 'singleton' } });
      const provider = config?.provider ?? 'anthropic';
      const model = config?.model ?? 'claude-haiku-4-5-20251001';
      const costs = getModelCosts(provider, model);
      const cost =
        (usage.inputTokens / 1000) * costs.costPer1kInput +
        (usage.outputTokens / 1000) * costs.costPer1kOutput;

      const errorDetail = failureReason
        ? `[${failureReason}] ${origin} → ${destination} ${dateFrom} to ${dateTo}`
        : null;

      await prisma.apiUsageLog.create({
        data: {
          provider,
          model,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          costUsd: cost,
          operation: 'preview-flights',
          durationMs: 0,
          error: errorDetail,
        },
      });

      if (failureReason) {
        const messages: Record<string, string> = {
          page_not_loaded: `[${failureReason}] Google Flights did not load results — the page was blocked or served a CAPTCHA. Try again in a few minutes.`,
          no_json_in_response: `[${failureReason}] Scraped the page but could not extract flight data — Google may have returned an error page. Try again.`,
          empty_extraction: `[${failureReason}] Page loaded but no flights were found in the HTML — Google may be rate-limiting. Try again in a few minutes.`,
          all_filtered_out: `[${failureReason}] Flights exist for ${origin} → ${destination}, but none matched your filters. Try relaxing price, stops, or airline preferences.`,
        };
        throw new Error(messages[failureReason] ?? `[${failureReason}] Flight extraction failed. Try again.`);
      }

      return extracted;
    });

    return apiSuccess({ flights: prices });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to preview flights';
    return apiError(msg, 500);
  }
}
