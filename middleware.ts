import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { adminFromUser } from '@/lib/adminRole';

// Every page and API route needs a signed-in admin, except the caregiver's upload link,
// the cron endpoint (it checks CRON_SECRET itself), the sign-in flow, and regulatory watch,
// which has its own sign-in, worker accounts and scheduler secret (lib/regulatory/auth.ts).
const PUBLIC = [/^\/u\//, /^\/api\/link\//, /^\/api\/cron$/, /^\/api\/auth\//, /^\/regulatory(\/|$)/, /^\/api\/regulatory\//];

export async function middleware(request: NextRequest) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY;
  const { pathname, search } = request.nextUrl;
  if (!url || !key || PUBLIC.some((p) => p.test(pathname))) return NextResponse.next();

  // refreshes the session cookie when needed (the @supabase/ssr middleware pattern)
  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        list.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });
  const { data } = await supabase.auth.getUser();
  const admin = adminFromUser(data.user);

  if (pathname === '/login') {
    return admin ? NextResponse.redirect(new URL('/', request.url)) : response;
  }
  if (admin) return response;
  if (pathname.startsWith('/api/')) return NextResponse.json({ error: 'Sign in to continue.' }, { status: 401 });
  const login = new URL('/login', request.url);
  if (pathname !== '/') login.searchParams.set('next', pathname + search);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ['/((?!_next/|samples/|favicon.ico).*)'],
};
