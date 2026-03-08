import { apiSuccess } from '@/lib/api-response';
import { EXTRACTION_PROVIDERS, detectAvailableProviders } from '@/lib/scraper/ai-registry';

interface ProviderStatus {
  displayName: string;
  status: 'ready' | 'no_key' | 'not_installed';
  models: string[];
}

export async function GET() {
  const available = await detectAvailableProviders();

  const statuses: Record<string, ProviderStatus> = {};

  for (const [key, config] of Object.entries(EXTRACTION_PROVIDERS)) {
    statuses[key] = {
      displayName: config.displayName,
      status: available.includes(key) ? 'ready' : key === 'claude-code' || key === 'codex' ? 'not_installed' : 'no_key',
      models: config.models.map((m) => m.name),
    };
  }

  return apiSuccess(statuses);
}
