"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useMap, Marker } from 'react-leaflet';
import L from 'leaflet';
import * as XLSX from 'xlsx';
import SalesDataModal from './SalesDataModal';
import { createPortal } from 'react-dom';

interface SalesAnalysisLayerProps {
    visible: boolean;
}

// Simple Cache for Geocoding to avoid hitting API limits repeatedly for same file
const GEO_CACHE_KEY = 'sales_analysis_geo_cache';

export default function SalesAnalysisLayer({ visible }: SalesAnalysisLayerProps) {
    const map = useMap();
    const [data, setData] = useState<any[]>([]);
    const [processedData, setProcessedData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [progress, setProgress] = useState({ current: 0, total: 0, text: '' });
    const [selectedBuilding, setSelectedBuilding] = useState<any>(null);
    const [selectedYear, setSelectedYear] = useState<string>('');
    const [isLoading, setIsLoading] = useState(true);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load cache on mount
    const [geoCache, setGeoCache] = useState<Record<string, { lat: number, lng: number }>>({});

    // Portal setup
    const [filterContainer, setFilterContainer] = useState<HTMLElement | null>(null);
    useEffect(() => {
        if (visible) {
            setTimeout(() => {
                setFilterContainer(document.getElementById('sales-analysis-filters-container'));
            }, 0);
        } else {
            setFilterContainer(null);
        }
    }, [visible]);

    // Fetch existing data on mount
    useEffect(() => {
        const loadInitialData = async () => {
            // Load Geo Cache
            const saved = localStorage.getItem(GEO_CACHE_KEY);
            if (saved) {
                try {
                    setGeoCache(JSON.parse(saved));
                } catch (e) {
                    console.error("Failed to load geo cache", e);
                }
            }

            // Load Sales Data from DB
            setIsLoading(true);
            try {
                const res = await fetch('/api/sales-data');
                if (res.ok) {
                    const dbData = await res.json();
                    if (Array.isArray(dbData) && dbData.length > 0) {
                        const formatted = dbData.map((item: any) => ({
                            ...item.data,
                            lat: item.lat,
                            lng: item.lng,
                            address_key: item.address_key
                        }));
                        setProcessedData(formatted);
                    }
                }
            } catch (error) {
                console.error('Error fetching sales data:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadInitialData();
    }, []);

    const saveCache = (newCache: Record<string, { lat: number, lng: number }>) => {
        setGeoCache(newCache);
        localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(newCache));
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setLoading(true);
        setProgress({ current: 0, total: 0, text: 'Luetaan tiedostoa...' });

        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const bstr = evt.target?.result;
                const wb = XLSX.read(bstr, { type: 'binary' });
                const wsname = wb.SheetNames[0];
                const ws = wb.Sheets[wsname];

                // Read using column letters (A, B, C...) as keys
                // Verify if headers are at row 4/5 (index 3/4). effectively data starts at row 6 (index 5)
                // We'll read from row 5 (index 4) to get 'units' line if needed, but data starts row 6 (index 5).
                // Let's read from index 5.
                const jsonData = XLSX.utils.sheet_to_json(ws, { header: "A", range: 5 });

                // Process and save
                await processAndSave((jsonData as any[]));

            } catch (err) {
                console.error(err);
                alert("Virhe tiedoston luvussa");
                setLoading(false);
            }
        };
        reader.readAsBinaryString(file);
    };

    const processAndSave = async (rawData: any[]) => {
        const toGeocode: any[] = [];
        const processed: any[] = [];
        const dbItems: any[] = [];

        // 1. Filter Valid Rows (Must have address in Col E and City in A)
        // Col E = Address, Col A = City.
        const validRows = rawData.filter(row => row['E'] && row['A']);

        setProgress({ current: 0, total: validRows.length, text: 'Valmistellaan...' });

        // 2. Prepare Geocoding
        // We reuse existing coords from DB (processedData) if available, or Cache, or Geocode

        // Map existing DB data for quick lookup
        const existingMap = new Map();
        processedData.forEach(p => {
            if (p.address_key) existingMap.set(p.address_key, { lat: p.lat, lng: p.lng });
        });

        for (const row of validRows) {
            const address = row['E']; // Address
            const city = row['A'] || 'Helsinki'; // City
            const key = `${address}, ${city}`.toLowerCase();

            let coords;
            if (existingMap.has(key)) coords = existingMap.get(key);
            else if (geoCache[key]) coords = geoCache[key];

            if (coords) {
                const item = { ...row, ...coords, address_key: key };
                processed.push(item);
                dbItems.push({ data: row, lat: coords.lat, lng: coords.lng, address_key: key });
            } else {
                toGeocode.push({ ...row, addressKey: key, searchAddress: `${address}, ${city}` });
            }
        }

        // 3. Geocode missing
        if (toGeocode.length > 0) {
            let completed = 0;
            const newCache = { ...geoCache };

            for (const item of toGeocode) {
                setProgress({
                    current: processed.length + completed + 1,
                    total: validRows.length,
                    text: `Haetaan sijaintia: ${item.searchAddress}`
                });

                try {
                    await new Promise(r => setTimeout(r, 1100)); // Rate limit
                    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(item.searchAddress)}&limit=1`);
                    const geoRes = await res.json();

                    if (geoRes && geoRes.length > 0) {
                        const coords = { lat: parseFloat(geoRes[0].lat), lng: parseFloat(geoRes[0].lon) };
                        const finalItem = { ...item, ...coords, address_key: item.addressKey };
                        processed.push(finalItem);
                        dbItems.push({ data: item, lat: coords.lat, lng: coords.lng, address_key: item.addressKey });
                        newCache[item.addressKey] = coords;
                    } else {
                        console.warn(`Could not geocode: ${item.searchAddress}`);
                    }
                } catch (err) {
                    console.error("Geocode error", err);
                }
                completed++;
            }
            saveCache(newCache);
        }

        setProcessedData(processed);

        // 4. Save to DB
        setProgress({ current: 0, total: 0, text: 'Tallennetaan tietokantaan...' });
        try {
            // Delete old data
            await fetch('/api/sales-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'deleteAll' })
            });

            // Save new data
            const res = await fetch('/api/sales-data', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: dbItems })
            });

            if (res.ok) {
                // Success
            } else {
                alert('Tietojen tallennus epäonnistui.');
            }
        } catch (e) {
            console.error(e);
            alert('Virhe tallennuksessa.');
        }

        setLoading(false);
        setProgress({ current: 0, total: 0, text: '' });
    };

    if (!visible) return null;

    // Custom Marker for Price
    const createPriceIcon = (price: number, ownership: string) => {
        const isOwn = ownership && String(ownership).toUpperCase().startsWith('O'); // O: Ownership check
        const colorClass = isOwn ? 'bg-blue-600' : 'bg-red-600';
        const priceStr = price ? Math.round(price).toString() : '?';

        return L.divIcon({
            className: 'custom-price-marker',
            html: `
                <div class="${colorClass} text-white font-bold text-xs rounded-full border-2 border-white shadow-md flex items-center justify-center" 
                     style="width: 40px; height: 40px; font-size: 11px;">
                    ${priceStr}
                </div>
            `,
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        });
    };

    // Filter for display based on cutoff year
    const displayData = processedData.filter(item => {
        // Col G: Valmistumisvuosi (YYYYMM) e.g. 202510 (Number) or "202510" (String)
        const dateVal = item['G'];
        let finishedYear = 0;

        if (typeof dateVal === 'number') {
            finishedYear = Math.floor(dateVal / 100); // 202510 -> 2025
        } else if (typeof dateVal === 'string') {
            finishedYear = parseInt(dateVal.substring(0, 4)) || 0;
        }

        // Col AI etc are unsold? User said Unsold AI. 
        // We can just check "Unsold Total" if there is a summary col.
        // User didn't give explicit "Unsold Total" column, but K is Total Units, S is Sold Units.
        // So Unsold = K - S.
        const totalUnits = parseFloat(item['K']) || 0;
        const soldUnits = parseFloat(item['S']) || 0;
        const unsoldTotal = Math.max(0, totalUnits - soldUnits);

        if (selectedYear) {
            const parsedYear = parseInt(selectedYear);
            if (!isNaN(parsedYear)) {
                return finishedYear >= parsedYear;
            }
        }

        return true;
    });

    const controlPanel = (
        <div className="space-y-3">
            {/* Year Input */}
            <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Valmistumisvuosi</label>
                <div className="flex items-center gap-2">
                    <input
                        type="number"
                        placeholder="Esim. 2026"
                        value={selectedYear}
                        onChange={(e) => setSelectedYear(e.target.value)}
                        className="w-full px-2 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                    />
                </div>
            </div>

            <div className="pt-2 border-t border-slate-100">
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">
                    {isLoading ? 'Ladataan...' : 'Päivitä tietokanta (Excel)'}
                </label>
                <input
                    type="file"
                    accept=".xlsx, .xls"
                    onChange={handleFileUpload}
                    disabled={loading || isLoading}
                    className="block w-full text-xs text-slate-500
                    file:mr-2 file:py-1 file:px-2
                    file:rounded file:border-0
                    file:text-xs file:font-semibold
                    file:bg-violet-50 file:text-violet-700
                    hover:file:bg-violet-100 disabled:opacity-50
                "
                />
            </div>

            {progress.text ? (
                <div className="mt-2">
                    <div className="text-[10px] font-medium text-blue-600 mb-1">{progress.text}</div>
                    {progress.total > 0 && (
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div
                                className="bg-blue-600 h-1.5 rounded-full transition-all duration-300"
                                style={{ width: `${(progress.current / progress.total) * 100}%` }}
                            ></div>
                        </div>
                    )}
                </div>
            ) : (
                <div className="mt-1 text-[10px] text-green-600 font-medium flex items-center justify-between">
                    {!isLoading && processedData.length > 0 && (
                        <>
                            <span>✓ {displayData.length} näkyvissä</span>
                            <span className="text-slate-400">({processedData.length} yht)</span>
                        </>
                    )}
                </div>
            )}

            {!isLoading && processedData.length > 0 && (
                <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-500 pt-1">
                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-600"></span> Omistus</div>
                    <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-600"></span> Vuokra</div>
                </div>
            )}
        </div>
    );

    return (
        <>
            {filterContainer && createPortal(controlPanel, filterContainer)}

            {/* Markers */}
            {displayData.map((item, idx) => {
                if (!item.lat || !item.lng) return null;
                // Col O: Price (Avg Sqm Price)
                const price = parseFloat(item['O']) || 0;
                // Col I: Tontin omistusmuoto (Omistus/Vuokra)
                const ownership = item['I'] || '';

                return (
                    <Marker
                        key={`${item.lat}-${item.lng}-${idx}`}
                        position={[item.lat, item.lng]}
                        icon={createPriceIcon(price, ownership)}
                        eventHandlers={{
                            click: () => setSelectedBuilding(item)
                        }}
                    />
                );
            })}

            <SalesDataModal
                isOpen={!!selectedBuilding}
                onClose={() => setSelectedBuilding(null)}
                data={selectedBuilding}
            />
        </>
    );
}
