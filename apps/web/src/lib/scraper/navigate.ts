import type { Query } from '@prisma/client';

interface NavigationResult {
  html: string;
  url: string;
}

function buildGoogleFlightsUrl(query: Query): string {
  const dateFrom = query.dateFrom.toISOString().split('T')[0];
  const dateTo = query.dateTo.toISOString().split('T')[0];

  // Google Flights URL format: /flights/origin-destination/dateFrom/dateTo
  return `https://www.google.com/travel/flights?q=flights+from+${query.origin}+to+${query.destination}+on+${dateFrom}+to+${dateTo}&curr=USD&hl=en`;
}

export async function navigateGoogleFlights(
  query: Query
): Promise<NavigationResult> {
  const { chromium } = await import('playwright');

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_PATH || undefined,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
    });

    const page = await context.newPage();
    const url = buildGoogleFlightsUrl(query);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });

    // Wait for flight results to load
    await page.waitForTimeout(3000);

    // Try to dismiss consent/cookie dialogs
    try {
      const consentButton = page.locator('button:has-text("Accept all")');
      if (await consentButton.isVisible({ timeout: 2000 })) {
        await consentButton.click();
        await page.waitForTimeout(1000);
      }
    } catch {
      // No consent dialog — continue
    }

    // Wait for flight results — look for price elements
    try {
      await page.waitForSelector('[data-gs]', { timeout: 15_000 });
    } catch {
      // Results may have loaded differently — continue with what we have
    }

    const html = await page.content();

    await context.close();
    return { html, url };
  } finally {
    await browser.close();
  }
}
