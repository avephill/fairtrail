import { prisma } from '@/lib/prisma';
import { detectAvailableProviders } from '@/lib/scraper/ai-registry';

export async function GET() {
  const config = await prisma.extractionConfig.findFirst({
    where: { id: 'singleton' },
  });

  const isSelfHosted = process.env.SELF_HOSTED === 'true';
  const setupComplete = isSelfHosted
    ? Boolean(config?.provider)
    : Boolean(config?.adminPasswordHash);
  const detectedProviders = await detectAvailableProviders();

  return Response.json({
    setupComplete,
    isSelfHosted,
    detectedProviders,
    currentProvider: config?.provider ?? null,
    currentModel: config?.model ?? null,
  });
}
