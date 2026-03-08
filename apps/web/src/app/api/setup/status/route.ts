import { prisma } from '@/lib/prisma';
import { detectAvailableProviders } from '@/lib/scraper/ai-registry';

export async function GET() {
  const config = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  const setupComplete = Boolean(config?.adminPasswordHash);
  const detectedProviders = await detectAvailableProviders();

  return Response.json({
    setupComplete,
    detectedProviders,
    currentProvider: config?.provider ?? null,
    currentModel: config?.model ?? null,
  });
}
