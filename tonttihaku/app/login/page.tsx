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
                document.cookie = `site_auth_token=${data.token}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Strict`;

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
