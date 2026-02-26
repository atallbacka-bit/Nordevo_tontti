import React, { useState, useEffect, useRef } from 'react';

export interface AddressSearchResult {
    lat: string;
    lon: string;
    display_name: string;
    address?: {
        road?: string;
        house_number?: string;
        city?: string;
        town?: string;
        village?: string;
        municipality?: string;
    };
}

interface AddressSearchProps {
    onSelect: (result: AddressSearchResult | null) => void;
}

export default function AddressSearch({ onSelect }: AddressSearchProps) {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<AddressSearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const search = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!query.trim()) return;

        setIsLoading(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=fi&addressdetails=1`);
            const data = await res.json();
            setResults(data);
            setIsOpen(true);
        } catch (error) {
            console.error('Error fetching address:', error);
        } finally {
            setIsLoading(false);
        }
    };

    const formatAddress = (result: AddressSearchResult) => {
        if (result.address) {
            const road = result.address.road || '';
            const hn = result.address.house_number || '';
            const street = `${road} ${hn}`.trim();

            const city = result.address.city || result.address.town || result.address.village || result.address.municipality || '';

            if (street && city) return `${street}, ${city}`;
            if (street) return street;
            if (city) return city;
        }

        // Fallback: take first two parts of display_name
        const parts = result.display_name.split(',').map(p => p.trim());
        if (parts.length >= 2) return `${parts[0]}, ${parts[1]}`;
        return parts[0] || result.display_name;
    };

    const handleSelect = (result: AddressSearchResult) => {
        const formatted = formatAddress(result);
        setQuery(formatted);
        setIsOpen(false);
        onSelect({ ...result, display_name: formatted });
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setQuery(value);
        if (value.trim() === '') {
            setResults([]);
            setIsOpen(false);
            onSelect(null);
        }
    };

    return (
        <div ref={wrapperRef} className="absolute top-[12px] right-[60px] z-[1000] w-64">
            <form onSubmit={search} className="relative flex items-center bg-white rounded-md shadow-md overflow-hidden border border-slate-200">
                <input
                    type="text"
                    value={query}
                    onChange={handleInputChange}
                    placeholder="Etsi osoite..."
                    className="w-full px-3 py-2 text-sm focus:outline-none"
                />
                <button
                    type="submit"
                    className="px-3 py-2 text-slate-500 hover:text-blue-600 transition-colors bg-white"
                    disabled={isLoading}
                >
                    {isLoading ? (
                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                    ) : (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                        </svg>
                    )}
                </button>
            </form>

            {isOpen && results.length > 0 && (
                <ul className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-slate-200 max-h-60 overflow-y-auto">
                    {results.map((result, idx) => (
                        <li
                            key={result.lat + '-' + result.lon + idx}
                            onClick={() => handleSelect(result)}
                            className="px-3 py-2 text-sm hover:bg-slate-50 cursor-pointer border-b border-slate-100 last:border-0"
                        >
                            {formatAddress(result)}
                        </li>
                    ))}
                </ul>
            )}

            {isOpen && results.length === 0 && !isLoading && query && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-white rounded-md shadow-lg border border-slate-200 p-3 text-sm text-slate-500 text-center">
                    Ei tuloksia
                </div>
            )}
        </div>
    );
}
