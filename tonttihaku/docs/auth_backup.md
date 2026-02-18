# Authentication Backup

This file contains the authentication logic as of 2026-02-18, before it was disabled to make the site public.

## 1. Middleware (`middleware.ts`)

```typescript
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
```

## 2. Login Page (`app/login/page.tsx`)

```typescript
'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const [password, setPassword] = useState('');
    const [username, setUsername] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);
    const router = useRouter();

    useEffect(() => {
        // If already logged in (cookie check handled by middleware, but check localStorage for username consistency)
        const user = localStorage.getItem('tonttihaku_user');
        if (user) setUsername(user);
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            const res = await fetch('/api/auth', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            const data = await res.json();

            if (data.success) {
                // Set cookie for middleware protection (expires in 30 days)
                document.cookie = `site_auth_token=${data.token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;

                // Store token in localStorage for client-side AuthProvider
                localStorage.setItem('tonttihaku_auth', data.token);

                // Store username for display/auditing
                localStorage.setItem('tonttihaku_user', username.trim() || 'Tuntematon');

                // Redirect to home
                // Use hard redirect to ensure cookies are sent and middleware runs fresh
                // prevent caching or stale state issues
                window.location.href = '/'; // Refresh to update server components/middleware state
            } else {
                setError(data.error || 'Kirjautuminen epäonnistui');
            }
        } catch (err) {
            setError('Yhteysvirhe. Yritä uudelleen.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
            <div className="w-full max-w-sm mx-4">
                <div className="bg-white/10 backdrop-blur-lg rounded-2xl shadow-2xl p-8 border border-white/20">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl font-bold text-white mb-2">Tonttihaku</h1>
                        <p className="text-blue-200/70 text-sm">Pääkaupunkiseudun tonttihaku</p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-5">
                        <div>
                            <label className="block text-sm font-medium text-blue-100 mb-1.5">
                                Nimi
                            </label>
                            <input
                                type="text"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Nimesi (näkyy muokkauksissa)"
                                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-blue-100 mb-1.5">
                                Salasana
                            </label>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Syötä salasana"
                                required
                                className="w-full px-4 py-3 rounded-lg bg-white/10 border border-white/20 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent transition-all"
                            />
                        </div>

                        {error && (
                            <div className="bg-red-500/20 border border-red-500/30 text-red-200 px-4 py-2.5 rounded-lg text-sm">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !password}
                            className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-lg transition-all duration-200 hover:shadow-blue-500/25"
                        >
                            {loading ? 'Kirjaudutaan...' : 'Kirjaudu'}
                        </button>
                    </form>
                </div>
            </div>
        </div>
    );
}
```

## 3. API Auth Route (`app/api/auth/route.ts`)

```typescript
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { password } = await req.json();
        const sitePassword = process.env.SITE_PASSWORD;

        if (!sitePassword) {
            console.error('SITE_PASSWORD env var not set');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        if (password === sitePassword) {
            // Create a simple session token (hash of password + a secret)
            const token = Buffer.from(`tonttihaku:${sitePassword}:${Date.now()}`).toString('base64');
            return NextResponse.json({ success: true, token });
        }

        return NextResponse.json({ error: 'Väärä salasana' }, { status: 401 });
    } catch (error) {
        console.error('Auth error:', error);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
```

## 4. AuthProvider (`components/AuthProvider.tsx`)

```typescript
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

interface AuthContextType {
    isAuthenticated: boolean;
    username: string;
    setUsername: (name: string) => void;
    logout: () => void;
}

const AuthContext = createContext<AuthContextType>({
    isAuthenticated: false,
    username: 'Tuntematon',
    setUsername: () => { },
    logout: () => { },
});

export function useAuth() {
    return useContext(AuthContext);
}

export default function AuthProvider({ children }: { children: React.ReactNode }) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsernameState] = useState('Tuntematon');
    const [isLoading, setIsLoading] = useState(true);
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        // Check auth on mount
        const localToken = localStorage.getItem('tonttihaku_auth');

        // Also check cookie as fallback (since middleware relies on it)
        // Use a regex to correctly capture the value even if it contains '=' (like base64 padding)
        const match = document.cookie.match(/(^|;)\s*site_auth_token=([^;]+)/);
        const cookieToken = match ? match[2] : undefined;

        const token = localToken || cookieToken;
        const storedUser = localStorage.getItem('tonttihaku_user');

        if (token) {
            setIsAuthenticated(true);
            setUsernameState(storedUser || 'Tuntematon');
            // If token in cookie but not local, sync local (optional but good)
            if (cookieToken && !localToken) {
                localStorage.setItem('tonttihaku_auth', cookieToken);
            }
        } else if (pathname !== '/login') {
            router.push('/login');
        }
        setIsLoading(false);
    }, [pathname, router]);

    const setUsername = (name: string) => {
        const trimmed = name.trim() || 'Tuntematon';
        setUsernameState(trimmed);
        localStorage.setItem('tonttihaku_user', trimmed);
    };

    const logout = () => {
        localStorage.removeItem('tonttihaku_auth');
        localStorage.removeItem('tonttihaku_user');
        setIsAuthenticated(false);
        router.push('/login');
    };

    // Don't render children while checking auth (prevents flash)
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-gray-500">Ladataan...</div>
            </div>
        );
    }

    // On login page, just render children (the login form)
    if (pathname === '/login') {
        return <>{children}</>;
    }

    // For other pages, we assume middleware handles protection.
    // If we are here, we are allowed.
    // We just need to ensure context has correct username/state if possible.
    // But we don't block rendering or force redirect anymore to avoid loops.

    return (
        <AuthContext.Provider value={{ isAuthenticated: true, username, setUsername, logout }}>
            {children}
        </AuthContext.Provider>
    );


}
```
