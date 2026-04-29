import { EXTRACTION_PROVIDERS, CLI_PROVIDERS, LOCAL_PROVIDERS, type ExtractionUsage } from './ai-registry';
import { prisma } from '@/lib/prisma';
import type { NavigationSource } from './navigate';

export interface PriceData {
  travelDate: string; // ISO date
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string | null;
  stops: number;
  duration: string | null;
  departureTime: string | null; // e.g. "10:25 AM"
  arrivalTime: string | null; // e.g. "4:45 PM"
  seatsLeft: number | null; // e.g. 3 when "3 seats left" shown
}

export interface QueryFilters {
  maxPrice: number | null;
  maxStops: number | null;
  preferredAirlines: string[];
  timePreference: string;
  cabinClass: string;
}

const DEFAULT_MAX_RESULTS = 10;

function detectCurrencyCodeFromText(text: string): string {
  if (text.includes('CurrencyEUR') || text.includes(' EUR') || text.includes('€')) return 'EUR';
  if (text.includes('CurrencyGBP') || text.includes(' GBP') || text.includes('£')) return 'GBP';
  if (text.includes('CurrencyJPY') || text.includes(' JPY') || text.includes('¥')) return 'JPY';
  return 'USD';
}

function extractByRegexFallback(
  html: string,
  travelDateFallback: string,
  searchUrl: string,
  filters: QueryFilters,
  maxResults: number,
  currency: string | null
): PriceData[] {
  // Google Flights text blocks often have this shape:
  // dep time -> arr time -> airline -> duration -> route -> stop info -> ... -> $price
  const pattern = /(\d{1,2}:\d{2}\s*[AP]M)\s*[\r\n]+\s*[–-]\s*[\r\n]+\s*(\d{1,2}:\d{2}\s*[AP]M(?:\+\d+)?)\s*[\r\n]+([^\r\n$]{2,120})[\r\n]+(\d{1,2}\s*hr(?:\s*\d{1,2}\s*min)?)[\s\S]{0,220}?(Nonstop|(\d+)\s+stop(?:s)?)?[\s\S]{0,220}?\$([0-9][0-9,]*)/gi;
  const inferredCurrency = currency ?? detectCurrencyCodeFromText(html);
  const out: PriceData[] = [];
  const seen = new Set<string>();

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(html)) !== null) {
    const departureTime = m[1]?.trim() ?? null;
    const arrivalTime = m[2]?.replace(/\+\d+$/, '').trim() ?? null;
    const airlineRaw = m[3]?.trim() ?? '';
    const duration = m[4]?.trim() ?? null;
    const stopToken = m[5]?.trim() ?? '';
    const stopCountToken = m[6]?.trim() ?? '';
    const price = Number((m[7] ?? '').replace(/,/g, ''));

    const airline = airlineRaw
      .replace(/\s{2,}/g, ' ')
      .replace(/Operated by.*/i, '')
      .trim();
    const stops = /nonstop/i.test(stopToken) ? 0 : Number(stopCountToken || '1');

    if (!Number.isFinite(price) || price <= 0 || !airline) continue;
    if (filters.maxPrice !== null && price > filters.maxPrice) continue;
    if (filters.maxStops !== null && stops > filters.maxStops) continue;
    if (
      filters.preferredAirlines.length > 0 &&
      !filters.preferredAirlines.some((a) => airline.toLowerCase().includes(a.toLowerCase()))
    ) continue;

    const key = `${airline}|${departureTime}|${arrivalTime}|${price}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      travelDate: travelDateFallback,
      price,
      currency: inferredCurrency,
      airline,
      bookingUrl: searchUrl,
      stops,
      duration,
      departureTime,
      arrivalTime,
      seatsLeft: null,
    });
  }

  return out
    .sort((a, b) => a.price - b.price)
    .slice(0, Math.max(1, maxResults));
}

function buildSystemPrompt(filters: QueryFilters, maxResults: number, source: NavigationSource = 'google_flights', currency: string | null = null): string {
  const filterRules: string[] = [];

  if (filters.maxPrice) {
    filterRules.push(`- ONLY include flights priced at or below ${filters.maxPrice}`);
  }
  if (filters.maxStops !== null) {
    filterRules.push(
      filters.maxStops === 0
        ? '- ONLY include nonstop/direct flights'
        : `- ONLY include flights with ${filters.maxStops} stop(s) or fewer`
    );
  }
  if (filters.preferredAirlines.length > 0) {
    filterRules.push(`- ONLY include flights operated by: ${filters.preferredAirlines.join(', ')}`);
  }
  if (filters.timePreference !== 'any') {
    const timeMap: Record<string, string> = {
      morning: 'departing before 12:00 PM',
      afternoon: 'departing between 12:00 PM and 6:00 PM',
      evening: 'departing after 6:00 PM',
      redeye: 'departing after 10:00 PM (red-eye flights)',
    };
    filterRules.push(`- Prefer flights ${timeMap[filters.timePreference] ?? ''}`);
  }

  const filterSection = filterRules.length > 0
    ? `\nFiltering rules (STRICT — do not include flights that violate these):\n${filterRules.join('\n')}\n`
    : '';

  const sourceDesc = source === 'airline_direct'
    ? "an airline's booking/search results page"
    : 'a Google Flights search results page';

  const bookingUrlRule = source === 'airline_direct'
    ? '- For bookingUrl, use the search URL provided (the airline website URL)'
    : "- If you can't find a direct booking URL, construct one from the Google Flights URL";

  const currencyInstruction = currency
    ? `- Use "${currency}" as the currency code for all results`
    : `- Detect the currency from the page content (look for $, EUR, GBP, £, JPY, ¥ symbols or codes). Use the ISO 4217 code. If unclear, use "USD"`;

  return `You are a flight price data extractor. Given the visible text content from ${sourceDesc}, extract the best matching flight options.

Return ONLY valid JSON — an array of UP TO ${maxResults} objects with this exact shape:
[
  {
    "travelDate": "YYYY-MM-DD",
    "price": 623,
    "currency": "${currency || 'USD'}",
    "airline": "Delta",
    "bookingUrl": "https://...",
    "stops": 1,
    "duration": "11h 20m",
    "departureTime": "10:25 AM",
    "arrivalTime": "4:45 PM",
    "seatsLeft": 3
  }
]
${filterSection}
General rules:
- Return at most ${maxResults} results, sorted by price (cheapest first)
- Price must be a number (no $ sign, no commas)
- For round-trip searches, Google Flights shows the FULL round-trip price on each flight. Do NOT halve or double it — extract the price exactly as shown
${currencyInstruction}
${bookingUrlRule}
- stops: 0 for nonstop, 1 for 1 stop, etc.
- duration: human-readable format like "8h 30m"
- departureTime: the departure time as shown (e.g. "10:25 AM", "7:50 PM"). Use null if not visible
- arrivalTime: the arrival time as shown (e.g. "4:45 PM", "11:30 AM"). Use null if not visible
- seatsLeft: if the page shows "N seats left" or "N seats left at this price", extract the number. Use null if not shown
- If the travel date is not clearly visible per result, use the search date provided
- Prefer variety: if multiple airlines are available, include at least one from each (up to the ${maxResults} limit)
- Return ONLY the JSON array, no markdown, no explanation
- If you cannot extract any flights, return an empty array []`;
}

export type ExtractionFailureReason =
  | 'page_not_loaded'
  | 'no_json_in_response'
  | 'empty_extraction'
  | 'all_filtered_out';

export interface ExtractionResult {
  prices: PriceData[];
  usage: ExtractionUsage;
  failureReason?: ExtractionFailureReason;
}

export async function extractPrices(
  html: string,
  searchUrl: string,
  travelDateFallback: string,
  filters: QueryFilters = { maxPrice: null, maxStops: null, preferredAirlines: [], timePreference: 'any', cabinClass: 'economy' },
  maxResults: number = DEFAULT_MAX_RESULTS,
  resultsFound: boolean = true,
  source: NavigationSource = 'google_flights',
  currency: string | null = null
): Promise<ExtractionResult> {
  if (!resultsFound) {
    console.log(`[extract] skipped — page did not load results (source=${source})`);
    return { prices: [], usage: { inputTokens: 0, outputTokens: 0 }, failureReason: 'page_not_loaded' };
  }

  const config = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  const provider = config?.provider ?? 'anthropic';
  const model = config?.model ?? 'claude-haiku-4-5-20251001';
  const providerConfig = EXTRACTION_PROVIDERS[provider];

  if (!providerConfig) {
    throw new Error(`Unknown extraction provider: ${provider}`);
  }

  const isCliProvider = provider in CLI_PROVIDERS;
  const isLocalProvider = LOCAL_PROVIDERS.has(provider);
  const hasLocalEndpoint =
    (provider === 'openai' && (config?.customBaseUrl || process.env.OPENAI_BASE_URL)) ||
    isLocalProvider;
  const apiKey = isCliProvider ? '' : (providerConfig.envKey ? process.env[providerConfig.envKey] : '') ?? '';
  if (!apiKey && !isCliProvider && !hasLocalEndpoint) {
    throw new Error(`Missing API key: ${providerConfig.envKey}`);
  }

  console.log(`[extract] sending ${html.length} chars to ${provider}/${model}`);

  const userPrompt = `Search URL: ${searchUrl}
Default travel date (if not visible per result): ${travelDateFallback}

Page content:
${html}`;

  const systemPrompt = buildSystemPrompt(filters, maxResults, source, currency);
  const result = await providerConfig.extract(apiKey, model, systemPrompt, userPrompt, {
    baseUrl: config?.customBaseUrl ?? undefined,
  });

  const jsonMatch = result.content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    if (source === 'google_flights') {
      const fallback = extractByRegexFallback(html, travelDateFallback, searchUrl, filters, maxResults, currency);
      if (fallback.length > 0) {
        console.log(`[extract] FALLBACK regex parse — ${fallback.length} flights`);
        return { prices: fallback, usage: result.usage };
      }
    }
    console.log(`[extract] FAIL no_json_in_response — LLM returned no parseable JSON`);
    return { prices: [], usage: result.usage, failureReason: 'no_json_in_response' };
  }

  const raw = JSON.parse(jsonMatch[0]) as PriceData[];

  if (raw.length === 0) {
    if (source === 'google_flights') {
      const fallback = extractByRegexFallback(html, travelDateFallback, searchUrl, filters, maxResults, currency);
      if (fallback.length > 0) {
        console.log(`[extract] FALLBACK regex parse after empty LLM output — ${fallback.length} flights`);
        return { prices: fallback, usage: result.usage };
      }
    }
    console.log(`[extract] FAIL empty_extraction — LLM returned [] (${result.usage.inputTokens} input tokens)`);
    return { prices: [], usage: result.usage, failureReason: 'empty_extraction' };
  }

  // Coerce null bookingUrl to empty string (LLMs frequently return null)
  for (const p of raw) {
    if (!p.bookingUrl) p.bookingUrl = '';
  }

  // Filter out obviously invalid entries
  const prices = raw.filter(
    (p) => p.price > 0 && p.airline && p.airline.length > 0
  );

  if (prices.length === 0) {
    console.log(`[extract] FAIL all_filtered_out — ${raw.length} raw results all invalid`);
    return { prices: [], usage: result.usage, failureReason: 'all_filtered_out' };
  }

  console.log(`[extract] OK — ${prices.length} flights extracted (cheapest: $${prices[0]?.price})`);
  return { prices, usage: result.usage };
}
