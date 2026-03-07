import { NextRequest } from 'next/server';
import { apiSuccess, apiError } from '@/lib/api-response';
import { verifyHashedPassword } from '@/lib/password';
import { prisma } from '@/lib/prisma';
import { createHmac } from 'crypto';

const GATE_COOKIE = 'ft-gate';
const GATE_ACTIVE_COOKIE = 'ft-gate-active';
const GATE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

function getSecret(): string {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set');
  return secret;
}

function createGateToken(): string {
  const payload = `gate:${Date.now()}`;
  const sig = createHmac('sha256', getSecret()).update(payload).digest('hex');
  return `${payload}.${sig}`;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  if (!body?.password) {
    return apiError('Missing password', 400);
  }

  const config = await prisma.extractionConfig.findUnique({
    where: { id: 'singleton' },
  });

  if (!config?.sitePasswordHash) {
    return apiError('No site password configured', 400);
  }

  const valid = await verifyHashedPassword(body.password, config.sitePasswordHash);
  if (!valid) {
    return apiError('Invalid password', 401);
  }

  const token = createGateToken();
  const response = apiSuccess({ ok: true });

  response.cookies.set(GATE_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GATE_MAX_AGE,
    path: '/',
  });

  response.cookies.set(GATE_ACTIVE_COOKIE, '1', {
    httpOnly: false,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: GATE_MAX_AGE,
    path: '/',
  });

  return response;
}
