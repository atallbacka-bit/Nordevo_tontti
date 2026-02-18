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
        const token = localStorage.getItem('tonttihaku_auth');
        const storedUser = localStorage.getItem('tonttihaku_user');

        if (token) {
            setIsAuthenticated(true);
            setUsernameState(storedUser || 'Tuntematon');
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

    // Not authenticated and not on login page — redirect happens in useEffect
    if (!isAuthenticated) {
        return (
            <div className="flex items-center justify-center h-screen bg-gray-100">
                <div className="text-gray-500">Ohjataan kirjautumiseen...</div>
            </div>
        );
    }

    return (
        <AuthContext.Provider value={{ isAuthenticated, username, setUsername, logout }}>
            {children}
        </AuthContext.Provider>
    );
}
