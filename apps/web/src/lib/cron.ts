const JITTER_RANGE_SECONDS = 150; // ±2.5 min → 5 min total window

let timer: ReturnType<typeof setTimeout> | null = null;
let cronIntervalHours = 3;
let lastScrapeAt: Date | null = null;
let nextScrapeAt: Date | null = null;
let jitterSeconds: number | null = null;

function computeJitter(): number {
  return Math.round((Math.random() * 2 - 1) * JITTER_RANGE_SECONDS);
}

function formatDuration(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function scheduleNext() {
  const baseMs = cronIntervalHours * 60 * 60 * 1000;
  const jitter = computeJitter();
  const delayMs = baseMs + jitter * 1000;

  jitterSeconds = jitter;
  nextScrapeAt = new Date(Date.now() + delayMs);

  const sign = jitter >= 0 ? '+' : '';
  console.log(`[cron] Next scrape in ${formatDuration(delayMs)} (jitter: ${sign}${jitter}s), at ${nextScrapeAt.toISOString()}`);

  timer = setTimeout(runAndReschedule, delayMs);
}

async function runAndReschedule() {
  console.log(`[cron] Starting scheduled scrape...`);
  try {
    const { runScrapeAll, cleanupUnvisitedQueries } = await import('./scraper/run-scrape');

    await cleanupUnvisitedQueries();
    const results = await runScrapeAll();
    lastScrapeAt = new Date();

    const successful = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'failed').length;
    const snapshots = results.reduce((sum, r) => sum + r.snapshotsCount, 0);
    console.log(`[cron] Scrape complete: ${successful} ok, ${failed} failed, ${snapshots} snapshots`);
  } catch (err) {
    console.error('[cron] Scrape failed:', err instanceof Error ? err.message : err);
  }

  scheduleNext();
}

export function getNextScrapeTime(): string | null {
  return nextScrapeAt?.toISOString() ?? null;
}

export function getCronInfo(): {
  intervalHours: number;
  jitterSeconds: number | null;
  nextScrape: string | null;
  lastScrape: string | null;
} {
  return {
    intervalHours: cronIntervalHours,
    jitterSeconds,
    nextScrape: getNextScrapeTime(),
    lastScrape: lastScrapeAt?.toISOString() ?? null,
  };
}

export function startCron() {
  if (process.env.CRON_ENABLED === 'false') {
    console.log('[cron] Disabled via CRON_ENABLED=false');
    return;
  }

  cronIntervalHours = Math.max(1, parseInt(process.env.CRON_INTERVAL_HOURS ?? '3', 10));

  console.log(`[cron] Starting with ${cronIntervalHours}h base interval (±${JITTER_RANGE_SECONDS}s jitter)`);
  scheduleNext();
}

export function stopCron() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
    nextScrapeAt = null;
    jitterSeconds = null;
    console.log('[cron] Stopped');
  }
}
