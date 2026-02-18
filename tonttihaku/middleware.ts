import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
    const authCookie = request.cookies.get('site_auth_token');
    const isAuth = !!authCookie;
    const isLoginPage = request.nextUrl.pathname === '/login';
    const isApi = request.nextUrl.pathname.startsWith('/api/');
    // Allow public access to auth API (login check) and static assets
    const isPublicApi = request.nextUrl.pathname === '/api/auth';

    // Allow static files and favicon explicitly if matcher misses them
    if (request.nextUrl.pathname.match(/\.(.*)$/)) {
        return NextResponse.next();
    }

    // 1. Redirect authenticated users away from login page
    if (isLoginPage && isAuth) {
        return NextResponse.redirect(new URL('/', request.url));
    }

    // 2. Allow login page access for unauthenticated users
    if (isLoginPage && !isAuth) {
        return NextResponse.next();
    }

    // 3. Protect API routes (except public auth)
    if (isApi) {
        if (isPublicApi) return NextResponse.next();
        if (!isAuth) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
        return NextResponse.next();
    }

    // 4. Protect all other pages (root, etc)
    if (!isAuth) {
        const loginUrl = new URL('/login', request.url);
        // clean any query params if needed, or keep to redirect back later
        return NextResponse.redirect(loginUrl);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!_next/static|_next/image|favicon.ico).*)',
    ],
};
