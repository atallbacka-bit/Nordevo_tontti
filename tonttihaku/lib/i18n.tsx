'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { EN } from './translations';

export type Lang = 'fi' | 'en';

const STORAGE_KEY = 'tonttihaku_lang';

interface LangContextType {
    lang: Lang;
    setLang: (l: Lang) => void;
    /**
     * Translate a Finnish source string. The Finnish text itself is the key, so
     * anything missing from the EN dictionary falls back to Finnish instead of
     * rendering a raw key. `vars` interpolates {name} placeholders.
     */
    t: (fi: string, vars?: Record<string, string | number>) => string;
}

const LangContext = createContext<LangContextType>({
    lang: 'fi',
    setLang: () => { },
    t: (fi) => fi,
});

export function useLang() {
    return useContext(LangContext);
}

/** Convenience hook when only the translate function is needed. */
export function useT() {
    return useContext(LangContext).t;
}

function interpolate(str: string, vars?: Record<string, string | number>): string {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
    const [lang, setLangState] = useState<Lang>('fi');

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored === 'en' || stored === 'fi') setLangState(stored);
    }, []);

    useEffect(() => {
        document.documentElement.lang = lang;
        // layout.tsx metadata is server-rendered in Finnish; keep the tab in sync.
        document.title = lang === 'en' ? 'Helsinki Region Plot Search' : 'Pääkaupunkiseutu Tonttihaku';
    }, [lang]);

    const setLang = useCallback((l: Lang) => {
        setLangState(l);
        localStorage.setItem(STORAGE_KEY, l);
    }, []);

    const t = useCallback(
        (fi: string, vars?: Record<string, string | number>) => {
            if (lang === 'fi') return interpolate(fi, vars);
            return interpolate(EN[fi] ?? fi, vars);
        },
        [lang]
    );

    return (
        <LangContext.Provider value={{ lang, setLang, t }}>
            {children}
        </LangContext.Provider>
    );
}

/** FI / EN segmented switch. `variant="dark"` for dark surfaces.
 *  Colours are inline so the control renders correctly regardless of which
 *  paths Tailwind's content globs happen to scan. */
export function LanguageToggle({
    className = '',
    variant = 'light',
}: {
    className?: string;
    variant?: 'light' | 'dark';
}) {
    const { lang, setLang } = useLang();
    const dark = variant === 'dark';

    const activeStyle = dark
        ? { background: '#ffffff', color: '#0f172a' }
        : { background: '#0f172a', color: '#ffffff' };
    const idleStyle = dark
        ? { background: 'transparent', color: 'rgba(219,234,254,0.8)' }
        : { background: 'transparent', color: '#475569' };

    return (
        <div
            className={`inline-flex items-center rounded-md overflow-hidden text-[11px] font-semibold ${className}`}
            style={{
                border: `1px solid ${dark ? 'rgba(255,255,255,0.25)' : '#cbd5e1'}`,
                background: dark ? 'rgba(255,255,255,0.1)' : '#ffffff',
            }}
            role="group"
            aria-label="Language / Kieli"
        >
            {(['fi', 'en'] as Lang[]).map((l) => (
                <button
                    key={l}
                    type="button"
                    onClick={() => setLang(l)}
                    aria-pressed={lang === l}
                    className="px-2 py-1 transition-colors"
                    style={lang === l ? activeStyle : idleStyle}
                >
                    {l.toUpperCase()}
                </button>
            ))}
        </div>
    );
}
