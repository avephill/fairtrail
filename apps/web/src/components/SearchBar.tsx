'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import type { ParseAmbiguity, ParsedFlightQuery, ParseResponse } from '@/lib/scraper/parse-query';
import type { PreviewRunStatusPayload } from '@/lib/preview-run';
import type { PriceData } from '@/lib/scraper/extract-prices';
import { detectLocaleCurrency } from '@/lib/currency';
import { addSavedTracker } from '@/lib/tracker-storage';
import { parseFairtrailApiJson, readFairtrailApiJson } from '@/lib/read-fairtrail-api-response';
import styles from './SearchBar.module.css';
import { ClarificationCard } from './ClarificationCard';
import { ConfirmationCard, type ParsedQuery } from './ConfirmationCard';
import { FlightPicker, type RouteFlights } from './FlightPicker';
import { LinkBanner, type CreatedTracker } from './LinkBanner';
import { ManualEntryForm, type ManualFormValues } from './ManualEntryForm';

const PREVIEW_STORAGE_KEY_BASE = 'ft-preview-run';
// Keep client polling window aligned with server-side preview stale timeout.
const PREVIEW_POLL_TIMEOUT_MS = 10 * 60 * 1000;
const PARSE_POLL_INTERVAL_MS = 1000;
const PARSE_POLL_TIMEOUT_MS = 10 * 60 * 1000;

function previewStorageKey(surface: SearchSurface): string {
  return surface === 'admin' ? `${PREVIEW_STORAGE_KEY_BASE}-admin` : PREVIEW_STORAGE_KEY_BASE;
}

export type SearchSurface = 'public' | 'admin';

interface SavedPreviewState {
  previewRunId: string;
  parsed: ParsedQuery;
  query: string;
  manualRawInput: string;
  vpnCountries: string[];
  startedAt: number;
}

interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

function playNotificationSound() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {
    // Audio not available
  }
}

function readSavedPreview(key: string): SavedPreviewState | null {
  if (typeof window === 'undefined') return null;

  try {
    const raw = window.sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as SavedPreviewState;
  } catch {
    return null;
  }
}

function writeSavedPreview(key: string, state: SavedPreviewState) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.setItem(key, JSON.stringify(state));
  } catch {
    // Ignore storage errors
  }
}

function clearSavedPreview(key: string) {
  if (typeof window === 'undefined') return;

  try {
    window.sessionStorage.removeItem(key);
  } catch {
    // Ignore storage errors
  }
}

export function SearchBar({
  initialQuery,
  surface = 'public',
}: {
  initialQuery?: string;
  surface?: SearchSurface;
} = {}) {
  const storageKey = previewStorageKey(surface);
  const [query, setQuery] = useState(initialQuery ?? '');
  const [parsed, setParsed] = useState<ParsedQuery | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [conversation, setConversation] = useState<ConversationMessage[]>([]);
  const [ambiguities, setAmbiguities] = useState<ParseAmbiguity[]>([]);
  const [partialParsed, setPartialParsed] = useState<ParsedFlightQuery | null>(null);

  const [previewRoutes, setPreviewRoutes] = useState<RouteFlights[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewRunId, setPreviewRunId] = useState<string | null>(null);

  const [vpnCountries, setVpnCountries] = useState<string[]>([]);
  const [adminCurrency, setAdminCurrency] = useState<string | null>(null);

  const [createdTrackers, setCreatedTrackers] = useState<CreatedTracker[] | null>(null);

  const [activeSearchMethod, setActiveSearchMethod] = useState<'ai' | 'manual'>('ai');
  const [manualMode, setManualMode] = useState(false);
  const [manualRawInput, setManualRawInput] = useState('');
  const [manualFormValues, setManualFormValues] = useState<ManualFormValues | null>(null);

  useEffect(() => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then((d) => {
        if (!d.ok) return;
        if (d.data.defaultCurrency) setAdminCurrency(d.data.defaultCurrency);
        const searchMethod = d.data.defaultSearchMethod === 'manual' ? 'manual' : 'ai';
        setActiveSearchMethod(searchMethod);
        setManualMode(searchMethod === 'manual');
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const saved = readSavedPreview(storageKey);
    if (!saved) return;

    setParsed(saved.parsed);
    setQuery(saved.query);
    setManualRawInput(saved.manualRawInput);
    setVpnCountries(saved.vpnCountries);
    setPreviewRunId(saved.previewRunId);
    setPreviewLoading(true);
  }, [storageKey]);

  const doParse = useCallback(async (input: string, history: ConversationMessage[]): Promise<boolean> => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: input,
          conversationHistory: history.length > 0 ? history : undefined,
        }),
      });

      const rawPost = await res.text();
      type ParsePostEnvelope = {
        ok?: boolean;
        data?: {
          parseRunId?: string;
          parsed?: ParsedFlightQuery | null;
          confidence?: 'high' | 'medium' | 'low';
          ambiguities?: ParseAmbiguity[];
          dateSpanDays?: number;
        };
        error?: string;
      };
      const postParsed = parseFairtrailApiJson<ParsePostEnvelope>(rawPost, res.status);
      if (!postParsed.ok) {
        setError(postParsed.userMessage);
        return false;
      }
      const postData = postParsed.json;

      if (!postData.ok) {
        setError(postData.error || 'Failed to parse query');
        return false;
      }

      const parseStartedAt = Date.now();
      const postBody = postData.data;
      if (!postBody) {
        setError('Failed to parse query');
        return false;
      }

      const asyncParseId = postBody.parseRunId;
      let parseResult: ParseResponse | null = null;

      if (asyncParseId) {
        while (Date.now() - parseStartedAt < PARSE_POLL_TIMEOUT_MS) {
          const pr = await fetch(`/api/parse/${asyncParseId}`, { cache: 'no-store' });
          const rawPoll = await pr.text();
          type ParsePollEnvelope = {
            ok?: boolean;
            data?: {
              status?: string;
              result?: {
                parsed: ParsedFlightQuery | null;
                confidence: 'high' | 'medium' | 'low';
                ambiguities: ParseAmbiguity[];
                dateSpanDays: number;
              } | null;
              error?: string | null;
            };
            error?: string;
          };
          const pollParsed = parseFairtrailApiJson<ParsePollEnvelope>(rawPoll, pr.status);
          if (!pollParsed.ok) {
            setError(pollParsed.userMessage);
            return false;
          }
          const pollData = pollParsed.json;

          if (!pollData.ok) {
            setError(pollData.error || 'Failed to parse query');
            return false;
          }

          const st = pollData.data?.status;
          if (st === 'completed' && pollData.data?.result) {
            parseResult = pollData.data.result;
            break;
          }
          if (st === 'failed') {
            setError(pollData.data?.error || 'Failed to parse query');
            return false;
          }

          await new Promise((r) => setTimeout(r, PARSE_POLL_INTERVAL_MS));
        }

        if (!parseResult) {
          setError('Parsing took too long. Try a smaller or faster model, or check that your LLM endpoint is healthy.');
          return false;
        }
      } else if (
        'confidence' in postBody &&
        'ambiguities' in postBody &&
        'dateSpanDays' in postBody
      ) {
        parseResult = postBody as unknown as ParseResponse;
      } else {
        setError('Failed to parse query');
        return false;
      }

      if (!parseResult) {
        setError('Failed to parse query');
        return false;
      }

      const { parsed: nextParsed, confidence, ambiguities: nextAmbiguities } = parseResult;

      if (nextParsed && !nextParsed.currency) {
        nextParsed.currency = adminCurrency || detectLocaleCurrency();
      }

      if (confidence === 'high' && nextParsed) {
        setParsed(nextParsed);
        setAmbiguities([]);
        setPartialParsed(null);
      } else {
        setParsed(null);
        setAmbiguities(nextAmbiguities || []);
        setPartialParsed(nextParsed);

        const assistantMsg =
          nextAmbiguities?.map((ambiguity: ParseAmbiguity) => ambiguity.question).join(' ') ||
          'Can you be more specific?';
        setConversation((prev) => [...prev, { role: 'assistant', content: assistantMsg }]);
      }
      return true;
    } catch {
      setError('Network error - please try again');
      return false;
    } finally {
      setLoading(false);
    }
  }, [adminCurrency]);

  useEffect(() => {
    if (!previewRunId || !parsed) return;

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const res = await fetch(`/api/preview/${previewRunId}`, { cache: 'no-store' });
        type PreviewPollEnvelope = { ok: boolean; data?: PreviewRunStatusPayload; error?: string };
        const read = await readFairtrailApiJson<PreviewPollEnvelope>(res);

        if (cancelled) return;

        if (!read.ok) {
          setError(read.userMessage);
          setPreviewLoading(false);
          setPreviewRunId(null);
          clearSavedPreview(storageKey);
          return;
        }

        const data = read.json;
        if (!data.ok) {
          setError(data.error || 'Failed to search flights');
          setPreviewLoading(false);
          setPreviewRunId(null);
          clearSavedPreview(storageKey);
          return;
        }

        const preview = data.data as PreviewRunStatusPayload;
        const saved = readSavedPreview(storageKey);

        if (saved && Date.now() - saved.startedAt > PREVIEW_POLL_TIMEOUT_MS) {
          setError('Flight search took too long. Please try again.');
          setPreviewLoading(false);
          setPreviewRunId(null);
          clearSavedPreview(storageKey);
          return;
        }

        if (preview.status === 'completed' && preview.result) {
          playNotificationSound();
          setPreviewRoutes(preview.result.routes);
          setPreviewLoading(false);
          setPreviewRunId(null);
          clearSavedPreview(storageKey);
          return;
        }

        if (preview.status === 'failed') {
          setError(preview.error || 'Failed to search flights');
          setPreviewLoading(false);
          setPreviewRunId(null);
          clearSavedPreview(storageKey);
          return;
        }

        timer = window.setTimeout(poll, 2000);
      } catch {
        if (cancelled) return;
        timer = window.setTimeout(poll, 3000);
      }
    };

    setPreviewLoading(true);
    void poll();

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [previewRunId, parsed, storageKey]);

  const handleParse = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || trimmed.length < 5) return;

    const history: ConversationMessage[] = [{ role: 'user', content: trimmed }];
    setConversation(history);
    setAmbiguities([]);
    setPartialParsed(null);
    setParsed(null);
    setPreviewRoutes(null);
    setPreviewRunId(null);
    setCreatedTrackers(null);
    setManualRawInput('');
    setManualFormValues(null);
    clearSavedPreview(storageKey);

    await doParse(trimmed, []);
  }, [query, doParse, storageKey]);

  const handleAnswer = useCallback(async (answer: string): Promise<boolean> => {
    const newConversation: ConversationMessage[] = [...conversation, { role: 'user', content: answer }];
    setConversation(newConversation);
    return doParse(answer, conversation);
  }, [conversation, doParse]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !loading) {
      handleParse();
    }
  };

  const handlePreview = async () => {
    if (!parsed) return;

    setPreviewLoading(true);
    setError(null);
    setPreviewRoutes(null);

    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });

      type PreviewStartEnvelope = {
        ok: boolean;
        data?: { previewRunId?: string; status?: string; expiresAt?: string };
        error?: string;
      };
      const read = await readFairtrailApiJson<PreviewStartEnvelope>(res);
      if (!read.ok) {
        setError(read.userMessage);
        setPreviewLoading(false);
        return;
      }

      const data = read.json;
      if (!data.ok) {
        setError(data.error || 'Failed to search flights');
        setPreviewLoading(false);
        return;
      }

      const nextPreviewRunId = data.data?.previewRunId as string | undefined;
      if (!nextPreviewRunId) {
        setError('Failed to start flight search');
        setPreviewLoading(false);
        return;
      }

      setPreviewRunId(nextPreviewRunId);
      writeSavedPreview(storageKey, {
        previewRunId: nextPreviewRunId,
        parsed,
        query,
        manualRawInput,
        vpnCountries,
        startedAt: Date.now(),
      });
    } catch {
      setError('Network error - please try again');
      setPreviewLoading(false);
    }
  };

  const handleTrackSelected = async (routeSelections: Array<{ route: RouteFlights; flights: PriceData[] }>) => {
    if (!parsed) return;

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/queries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rawInput: manualRawInput || query.trim(),
          dateFrom: parsed.dateFrom,
          dateTo: parsed.dateTo,
          flexibility: parsed.flexibility,
          maxPrice: parsed.maxPrice,
          maxStops: parsed.maxStops,
          preferredAirlines: parsed.preferredAirlines,
          timePreference: parsed.timePreference,
          currency: parsed.currency,
          cabinClass: parsed.cabinClass,
          tripType: parsed.tripType,
          vpnCountries,
          routes: routeSelections.map((selection) => ({
            origin: selection.route.origin,
            originName: selection.route.originName,
            destination: selection.route.destination,
            destinationName: selection.route.destinationName,
            date: selection.route.date,
            returnDate: selection.route.returnDate,
            selectedFlights: selection.flights,
          })),
        }),
      });

      type CreatedQueryRow = {
        id: string;
        origin: string;
        originName: string;
        destination: string;
        destinationName: string;
        date?: string;
        returnDate?: string;
        deleteToken: string;
      };
      type QueriesCreateEnvelope = { ok: boolean; data?: { queries: CreatedQueryRow[] }; error?: string };
      const read = await readFairtrailApiJson<QueriesCreateEnvelope>(res);
      if (!read.ok) {
        setError(read.userMessage);
        return;
      }

      const data = read.json;
      if (!data.ok || !data.data?.queries) {
        setError(data.error || 'Failed to create tracker');
        return;
      }

      const queries = data.data.queries;

      for (const trackedQuery of queries) {
        addSavedTracker({
          id: trackedQuery.id,
          origin: trackedQuery.origin,
          destination: trackedQuery.destination,
          originName: trackedQuery.originName,
          destinationName: trackedQuery.destinationName,
          dateFrom: trackedQuery.date || parsed.dateFrom,
          dateTo: trackedQuery.returnDate || parsed.dateTo,
          createdAt: new Date().toISOString(),
          deleteToken: trackedQuery.deleteToken,
        });
      }

      setCreatedTrackers(queries.map((trackedQuery) => ({
        id: trackedQuery.id,
        origin: trackedQuery.origin,
        originName: trackedQuery.originName,
        destination: trackedQuery.destination,
        destinationName: trackedQuery.destinationName,
        date: trackedQuery.date,
      })));

      setPreviewRunId(null);
      clearSavedPreview(storageKey);
    } catch {
      setError('Network error - please try again');
    } finally {
      setLoading(false);
    }
  };

  const handleBackFromPicker = () => {
    setPreviewRoutes(null);
    setPreviewRunId(null);
    clearSavedPreview(storageKey);
  };

  const [editingValues, setEditingValues] = useState<ManualFormValues | null>(null);

  const handleReset = () => {
    setParsed(null);
    setError(null);
    setConversation([]);
    setAmbiguities([]);
    setPartialParsed(null);
    setPreviewRoutes(null);
    setPreviewLoading(false);
    setPreviewRunId(null);
    setCreatedTrackers(null);
    setManualMode(activeSearchMethod === 'manual');
    setManualRawInput('');
    setManualFormValues(null);
    setVpnCountries([]);
    setEditingValues(null);
    clearSavedPreview(storageKey);
    inputRef.current?.focus();
  };

  const handleEdit = () => {
    const wasManual = !!manualFormValues;

    setError(null);
    setConversation([]);
    setAmbiguities([]);
    setPartialParsed(null);
    setPreviewRoutes(null);
    setPreviewLoading(false);
    setPreviewRunId(null);
    setCreatedTrackers(null);
    clearSavedPreview(storageKey);

    if (wasManual) {
      setEditingValues(manualFormValues);
      setParsed(null);
      setManualMode(true);
    } else {
      setParsed(null);
      setEditingValues(null);
      inputRef.current?.focus();
    }
  };

  const showClarification = ambiguities.length > 0 && !parsed;
  const showConfirmation = parsed && !previewRoutes && !createdTrackers && !previewLoading;
  const showPreviewLoading = parsed && previewLoading && !previewRoutes;
  const showPicker = parsed && previewRoutes && !createdTrackers;

  return (
    <div className={styles.root}>
      {manualMode ? (
        <ManualEntryForm
          onSubmit={(nextParsed, rawInput, formValues) => {
            setParsed(nextParsed);
            setManualRawInput(rawInput);
            setManualFormValues(formValues);
            setManualMode(false);
            setEditingValues(null);
          }}
          onCancel={() => {
            setActiveSearchMethod('ai');
            setManualMode(false);
            setEditingValues(null);
          }}
          adminCurrency={adminCurrency}
          cancelLabel="Use AI search"
          initialValues={editingValues ?? undefined}
        />
      ) : (
        <>
          <div className={styles.inputWrapper}>
            <input
              ref={inputRef}
              type="text"
              className={styles.input}
              placeholder="NYC to Paris around June 15 +/- 3 days"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
              autoFocus
            />
            <button
              className={styles.searchButton}
              onClick={handleParse}
              disabled={loading || query.trim().length < 5}
            >
              {loading ? (
                <span className={styles.spinner} />
              ) : (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              )}
            </button>
          </div>

          <div className={styles.hints}>
            {['JFK to CDG June 15-20', 'London to Tokyo next month flexible', 'SFO to LAX March 20 +/- 2 days'].map((example, i) => (
              <span key={i}>
                {i > 0 && <span className={styles.hintSep}>&middot; </span>}
                <button
                  type="button"
                  className={styles.hintBtn}
                  onClick={() => {
                    setQuery(example);
                    inputRef.current?.focus();
                  }}
                >
                  {example}
                </button>
              </span>
            ))}
          </div>

          {!parsed && !loading && (
            <>
              <button
                type="button"
                className={styles.randomFlight}
                onClick={() => {
                  const base = new Date();
                  base.setDate(base.getDate() + 21 + Math.floor(Math.random() * 21));
                  const dep = base.toISOString().split('T')[0]!;
                  const ret = new Date(base);
                  ret.setDate(ret.getDate() + 5 + Math.floor(Math.random() * 5));
                  const retStr = ret.toISOString().split('T')[0]!;

                  const routes = [
                    `JFK to CDG ${dep} to ${retStr} round trip economy`,
                    `LAX to NRT ${dep} to ${retStr} round trip economy`,
                    `ORD to FCO ${dep} to ${retStr} round trip economy`,
                    `MIA to BOG ${dep} one way economy`,
                    `SFO to LHR ${dep} to ${retStr} round trip economy`,
                    `BOS to BCN ${dep} to ${retStr} round trip economy`,
                    `SEA to ICN ${dep} to ${retStr} round trip economy`,
                    `DEN to AMS ${dep} to ${retStr} round trip economy`,
                    `DFW to CUN ${dep} to ${retStr} round trip economy`,
                    `ATL to DUB ${dep} to ${retStr} round trip economy`,
                  ];
                  const pick = routes[Math.floor(Math.random() * routes.length)]!;
                  setQuery(pick);
                  void doParse(pick, []);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22M22 6l-4-4M22 6l-4 4M2 6h1.4c1.3 0 2.5.6 3.3 1.7l6.1 8.6c.7 1.1 2 1.7 3.3 1.7H22M22 18l-4-4M22 18l-4 4" />
                </svg>
                Try a random flight
              </button>
              <button
                type="button"
                className={styles.manualToggle}
                onClick={() => {
                  setError(null);
                  setAmbiguities([]);
                  setPartialParsed(null);
                  setActiveSearchMethod('manual');
                  setManualMode(true);
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                </svg>
                Enter flight details manually
              </button>
            </>
          )}
        </>
      )}

      {error && <div className={styles.error}>{error}</div>}

      {showClarification && (
        <ClarificationCard
          ambiguities={ambiguities}
          partialParsed={partialParsed}
          onAnswer={handleAnswer}
          onReset={handleReset}
          loading={loading}
        />
      )}

      {showConfirmation && (
        <ConfirmationCard
          parsed={parsed}
          onTrack={handlePreview}
          onEdit={handleEdit}
          loading={loading}
          vpnCountries={vpnCountries}
          onVpnCountriesChange={setVpnCountries}
        />
      )}

      {showPreviewLoading && parsed && (
        <div className={styles.previewLoading}>
          <span className={styles.previewRoute}>
            {parsed.origins.map((airport) => airport.code).join(', ')}
            {' -> '}
            {parsed.destinations.map((airport) => airport.code).join(', ')}
          </span>
          <span className={styles.previewStatus}>Searching Google Flights...</span>
        </div>
      )}

      {showPicker && previewRoutes && (
        <FlightPicker
          routes={previewRoutes}
          onTrack={handleTrackSelected}
          onBack={handleBackFromPicker}
          onEdit={handleEdit}
          loading={loading}
        />
      )}

      {createdTrackers && (
        <LinkBanner
          trackers={createdTrackers}
          onDismiss={handleReset}
        />
      )}
    </div>
  );
}
