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
    // AUTHENTICATION DISABLED (Public Access Mode)
    // Default to true so all components behave as if logged in
    const [isAuthenticated, setIsAuthenticated] = useState(true);
    const [username, setUsernameState] = useState('Vierailija');
    const [isLoading, setIsLoading] = useState(false); // No loading needed
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        // We still check for a stored username just for display purposes
        const storedUser = localStorage.getItem('tonttihaku_user');
        if (storedUser) {
            setUsernameState(storedUser);
        }
    }, []);

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
