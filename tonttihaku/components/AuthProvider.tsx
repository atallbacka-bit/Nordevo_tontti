'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useT } from '@/lib/i18n';

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
    const t = useT();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [username, setUsernameState] = useState('Tuntematon');
    const [isLoading, setIsLoading] = useState(true);
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        // Check auth on mount
        const localToken = localStorage.getItem('tonttihaku_auth');

        // Also check cookie as fallback (since middleware relies on it)
        const match = document.cookie.match(/(^|;)\s*site_auth_token=([^;]+)/);
        const cookieToken = match ? match[2] : undefined;

        const token = localToken || cookieToken;
        const storedUser = localStorage.getItem('tonttihaku_user');

        if (token) {
            setIsAuthenticated(true);
            setUsernameState(storedUser || 'Tuntematon');
            // If token in cookie but not local, sync local
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
        // Clear cookie
        document.cookie = 'site_auth_token=; path=/; max-age=0; SameSite=Lax';
        localStorage.removeItem('tonttihaku_auth');
        localStorage.removeItem('tonttihaku_user');
        setIsAuthenticated(false);
        router.push('/login');
    };

    // Don't render children while checking auth (prevents flash)
    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-gray-500">{t('Ladataan...')}</div>
            </div>
        );
    }

    // On login page, just render children (the login form)
    if (pathname === '/login') {
        return <>{children}</>;
    }

    // For other pages, middleware handles protection.
    return (
        <AuthContext.Provider value={{ isAuthenticated: true, username, setUsername, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
