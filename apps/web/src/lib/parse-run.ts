import type { ParseResponse } from '@/lib/scraper/parse-query';

export interface ParseRunRequestPayload {
  query: string;
  conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

export interface ParseRunStatusPayload {
  id: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result: ParseResponse | null;
  error: string | null;
  expiresAt: string;
}
