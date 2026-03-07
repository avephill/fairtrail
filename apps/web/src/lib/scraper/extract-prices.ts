import { EXTRACTION_PROVIDERS, type ExtractionUsage } from './ai-registry';
import { prisma } from '@/lib/prisma';

export interface PriceData {
  travelDate: string; // ISO date
  price: number;
  currency: string;
  airline: string;
  bookingUrl: string;
  stops: number;
  duration: string | null;
}

const SYSTEM_PROMPT = `You are a flight price data extractor. Given HTML from a Google Flights search results page, extract all visible flight options.

Return ONLY valid JSON — an array of objects with this exact shape:
[
  {
    "travelDate": "YYYY-MM-DD",
    "price": 623,
    "currency": "USD",
    "airline": "Delta",
    "bookingUrl": "https://www.google.com/travel/flights/booking?...",
    "stops": 1,
    "duration": "11h 20m"
  }
]

Rules:
- Extract ALL visible flight results, not just the cheapest
- Price must be a number (no $ sign, no commas)
- If you can't find a direct booking URL, construct one from the Google Flights URL
- stops: 0 for nonstop, 1 for 1 stop, etc.
- duration: human-readable format like "8h 30m"
- If the travel date is not clearly visible per result, use the search date provided
- Return ONLY the JSON array, no markdown, no explanation
- If you cannot extract any flights, return an empty array []`;

export async function extractPrices(
  html: string,
  searchUrl: string,
  travelDateFallback: string
): Promise<{ prices: PriceData[]; usage: ExtractionUsage }> {
  const config = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  const provider = config?.provider ?? 'anthropic';
  const model = config?.model ?? 'claude-haiku-4-5-20251001';
  const providerConfig = EXTRACTION_PROVIDERS[provider];

  if (!providerConfig) {
    throw new Error(`Unknown extraction provider: ${provider}`);
  }

  const apiKey = process.env[providerConfig.envKey];
  if (!apiKey) {
    throw new Error(`Missing API key: ${providerConfig.envKey}`);
  }

  // Trim HTML to reduce token usage — keep only the main content area
  const trimmedHtml = trimFlightHtml(html);

  const userPrompt = `Search URL: ${searchUrl}
Default travel date (if not visible per result): ${travelDateFallback}

HTML content:
${trimmedHtml}`;

  const result = await providerConfig.extract(apiKey, model, SYSTEM_PROMPT, userPrompt);

  const jsonMatch = result.content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    return { prices: [], usage: result.usage };
  }

  const raw = JSON.parse(jsonMatch[0]) as PriceData[];

  // Filter out obviously invalid entries
  const prices = raw.filter(
    (p) => p.price > 0 && p.airline && p.airline.length > 0
  );

  return { prices, usage: result.usage };
}

function trimFlightHtml(html: string): string {
  // Remove script tags, style tags, and excessive whitespace
  let trimmed = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<svg[\s\S]*?<\/svg>/gi, '')
    .replace(/<img[^>]*>/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/>\s+</g, '><');

  // Cap at ~50k chars to stay within token limits
  if (trimmed.length > 50_000) {
    trimmed = trimmed.slice(0, 50_000);
  }

  return trimmed;
}
