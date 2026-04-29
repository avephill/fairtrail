/**
 * Fairtrail API routes return JSON envelopes. Reverse proxies (nginx, etc.)
 * may return HTML on timeouts — parse failures should surface a clear hint.
 */
export function explainNonJsonApiBody(raw: string, httpStatus: number): string {
  const head = raw.slice(0, 800);
  if (
    httpStatus === 504 ||
    httpStatus === 502 ||
    head.includes('504 Gateway') ||
    head.includes('Gateway Time-out') ||
    head.includes('502 Bad Gateway') ||
    head.includes('Bad Gateway')
  ) {
    return 'A reverse proxy (often nginx) timed out waiting for Fairtrail. Increase proxy_read_timeout, proxy_send_timeout, and send_timeout for this site (try 600s). Previews with a local LLM can take several minutes.';
  }
  if (httpStatus >= 400 && raw.trimStart().startsWith('<')) {
    return 'Received an HTML error page instead of JSON — usually a reverse-proxy timeout or mis-route in front of Fairtrail.';
  }
  return 'Network error - please try again';
}

export function parseFairtrailApiJson<T>(raw: string, httpStatus: number): { ok: true; json: T } | { ok: false; userMessage: string } {
  try {
    return { ok: true, json: JSON.parse(raw) as T };
  } catch {
    return { ok: false, userMessage: explainNonJsonApiBody(raw, httpStatus) };
  }
}

export async function readFairtrailApiJson<T>(res: Response): Promise<{ ok: true; json: T } | { ok: false; userMessage: string }> {
  const raw = await res.text();
  return parseFairtrailApiJson<T>(raw, res.status);
}
