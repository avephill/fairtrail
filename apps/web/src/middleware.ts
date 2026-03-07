import { NextRequest, NextResponse } from 'next/server';

const SESSION_COOKIE = 'ft-session';
const GATE_COOKIE = 'ft-gate';
const GATE_ACTIVE_COOKIE = 'ft-gate-active';

async function verifyHmacToken(token: string): Promise<boolean> {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret) return false;

  const lastDot = token.lastIndexOf('.');
  if (lastDot === -1) return false;

  const payload = token.slice(0, lastDot);
  const sig = token.slice(lastDot + 1);

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  const expected = Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return sig === expected;
}

const GATE_EXEMPT = [
  '/gate',
  '/api/gate',
  '/q/',
  '/api/queries/',
  '/admin',
  '/api/admin',
  '/api/health',
  '/api/cron',
];

function isGateExempt(pathname: string): boolean {
  return GATE_EXEMPT.some((prefix) => pathname.startsWith(prefix));
}

function isApiRoute(pathname: string): boolean {
  return pathname.startsWith('/api/');
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Admin pages (not login) — require session
  if (pathname.startsWith('/admin') && !pathname.startsWith('/admin/login')) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token || !(await verifyHmacToken(token))) {
      return NextResponse.redirect(new URL('/admin/login', request.url));
    }
  }

  // Admin API routes — require session
  if (pathname.startsWith('/api/admin') && !pathname.startsWith('/api/admin/auth')) {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    if (!token || !(await verifyHmacToken(token))) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  // Site gate — only enforce if gate is active (ft-gate-active cookie present)
  if (!isGateExempt(pathname)) {
    const gateActive = request.cookies.get(GATE_ACTIVE_COOKIE)?.value;
    if (gateActive) {
      const gateToken = request.cookies.get(GATE_COOKIE)?.value;
      if (!gateToken || !(await verifyHmacToken(gateToken))) {
        if (isApiRoute(pathname)) {
          return NextResponse.json({ ok: false, error: 'Site password required' }, { status: 401 });
        }
        return NextResponse.redirect(new URL('/gate', request.url));
      }
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon\\.ico).*)'],
};
