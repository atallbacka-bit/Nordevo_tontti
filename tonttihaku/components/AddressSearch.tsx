import React, { useState, useEffect, useRef } from 'react';

export interface AddressSearchResult {
    lat: string;
    lon: string;
    display_name: string;
}

interface AddressSearchProps {
    onSelect: (result: AddressSearchResult | null) => void;
    // Current map center, used to rank nearby matches first
    getFocusPoint?: () => { lat: number; lng: number };
}

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 300;

export default function AddressSearch({ onSelect, getFocusPoint }: AddressSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<AddressSearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [highlighted, setHighlighted] = useState(-1);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
    }, []);

    // Keep the highlighted option visible when navigating with arrow keys
    useEffect(() => {
        if (highlighted < 0) return;
        listRef.current?.children[highlighted]?.scrollIntoView({ block: 'nearest' });
    }, [highlighted]);

    const fetchResults = async (text: string) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);
        try {
            const params = new URLSearchParams({ text });
            const focus = getFocusPoint?.();
            if (focus) {
                params.set('lat', String(focus.lat));
                params.set('lon', String(focus.lng));
            }
            const res = await fetch(`/api/geocode?${params}`, { signal: controller.signal });
            if (!res.ok) throw new Error(`Geocode request failed: ${res.status}`);
            const data: AddressSearchResult[] = await res.json();
            setResults(data);
            setHighlighted(-1);
            setIsOpen(true);
        } catch (error) {
            if (!(error instanceof DOMException && error.name === 'AbortError')) {
                console.error('Error fetching address:', error);
            }
        } finally {
            if (abortRef.current === controller) setIsLoading(false);
        }
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
        if (debounceRef.current) clearTimeout(debounceRef.current);

        const trimmed = value.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            abortRef.current?.abort();
            setResults([]);
            setIsOpen(false);
            setIsLoading(false);
            if (trimmed === '') onSelect(null);
            return;
        }
        debounceRef.current = setTimeout(() => fetchResults(trimmed), DEBOUNCE_MS);
    };

    const handleSelect = (result: AddressSearchResult) => {
        setQuery(result.display_name);
        setIsOpen(false);
        setResults([]);
        setHighlighted(-1);
        onSelect(result);
    };

    const handleClear = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        abortRef.current?.abort();
        setQuery('');
        setResults([]);
        setIsOpen(false);
        setIsLoading(false);
        setHighlighted(-1);
        onSelect(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            return;
        }
        if (!isOpen || results.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlighted(h => (h + 1) % results.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlighted(h => (h <= 0 ? results.length - 1 : h - 1));
        } else if (e.key === 'Enter') {
            e.preventDefault();
            handleSelect(results[highlighted >= 0 ? highlighted : 0]);
        }
    };

    // Enter before the debounce fires: search immediately instead of waiting
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = query.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) return;
        if (debounceRef.current) clearTimeout(debounceRef.current);
        fetchResults(trimmed);
    };

    return (
        <div ref={wrapperRef} className="absolute top-[12px] right-[60px] z-[1000] w-64">
            <form onSubmit={handleSubmit} className="relative flex items-center bg-white rounded-md shadow-md overflow-hidden border border-slate-200">
                <input
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    placeholder="Etsi osoite..."
                    role="combobox"
                    aria-expanded={isOpen}
                    aria-controls="address-search-listbox"
                    aria-autocomplete="list"
                    autoComplete="off"
                    className="w-full px-3 py-2 text-sm focus:outline-none"
                />
                <button
                    type="button"
                    onClick={query ? handleClear : undefined}
                    className="px-3 py-2 text-slate-500 hover:text-blue-600 transition-colors bg-white"
                    aria-label={query ? 'Tyhjennä haku' : 'Etsi osoite'}
                >
                    {isLoading ? (
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : query ? (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    )}
                </button>
            </form>

            {isOpen && results.length > 0 && (
                <ul
                    ref={listRef}
                    id="address-search-listbox"
                    role="listbox"
                    className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-slate-200 max-h-60 overflow-y-auto"
                >
                    {results.map((result, idx) => (
                        <li
                            key={result.lat + '-' + result.lon + idx}
                            role="option"
                            aria-selected={idx === highlighted}
                            onClick={() => handleSelect(result)}
                            onMouseEnter={() => setHighlighted(idx)}
                            className={`px-3 py-2 text-sm cursor-pointer border-b border-slate-100 last:border-0 ${idx === highlighted ? 'bg-slate-100' : ''}`}
                        >
                            {result.display_name}
                        </li>
                    ))}
                </ul>
            )}

            {isOpen && results.length === 0 && !isLoading && query.trim().length >= MIN_QUERY_LENGTH && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-slate-200 p-3 text-sm text-slate-500 text-center">
                    Ei tuloksia
                </div>
            )}
        </div>
    );
}
