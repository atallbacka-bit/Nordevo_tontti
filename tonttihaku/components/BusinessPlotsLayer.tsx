"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useMap, Marker, Popup, GeoJSON } from 'react-leaflet';
import L from 'leaflet';
import { fetchBusinessPlots, BusinessPlot } from '@/lib/wfs-service';

interface BusinessPlotsLayerProps {
    visible: boolean;
}

export default function BusinessPlotsLayer({ visible }: BusinessPlotsLayerProps) {
    const map = useMap();
    const [data, setData] = useState<BusinessPlot[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedPlot, setSelectedPlot] = useState<BusinessPlot | null>(null);

    // Filters
    const [filters, setFilters] = useState({
        minArea: '',
        maxArea: '',
        minBuildRight: '',
        maxBuildRight: '',
        usage: [] as string[] // Changed to array for multi-select
    });

    const [usageOptions, setUsageOptions] = useState<string[]>([]);

    useEffect(() => {
        if (visible && data.length === 0 && !loading) {
            setLoading(true);
            fetchBusinessPlots()
                .then(plots => {
                    setData(plots);
                    // Extract unique usage options
                    const usages = Array.from(new Set(plots.map(p => p.kayttotarkoitusmerkinta).filter(Boolean))).sort();
                    setUsageOptions(usages);
                })
                .catch(err => console.error("Failed to load business plots", err))
                .finally(() => setLoading(false));
        }
    }, [visible, data.length, loading]);

    // Filter Logic
    const filteredData = useMemo(() => {
        return data.filter(plot => {
            const area = parseFloat(plot.pinta_ala) || 0;
            const buildRight = parseFloat(plot.rakennusoikeus) || 0;
            const usage = plot.kayttotarkoitusmerkinta || '';

            if (filters.minArea && area < parseFloat(filters.minArea)) return false;
            if (filters.maxArea && area > parseFloat(filters.maxArea)) return false;
            if (filters.minBuildRight && buildRight < parseFloat(filters.minBuildRight)) return false;
            if (filters.maxBuildRight && buildRight > parseFloat(filters.maxBuildRight)) return false;
            if (filters.usage.length > 0 && !filters.usage.includes(usage)) return false;

            return true;
        });
    }, [data, filters]);

    // Custom Icon for Pins (Modernized)
    const createInfoIcon = (usage: string, buildRight: string) => {
        return L.divIcon({
            className: 'custom-info-marker',
            html: `
                <div class="relative flex flex-col items-center group cursor-pointer transition-transform hover:scale-110 hover:z-50" style="transform-origin: bottom center;">
                    <div class="bg-slate-900 text-white shadow-xl rounded-lg px-2 py-1.5 flex flex-col items-center min-w-[50px] border-2 border-white ring-1 ring-black/5">
                        <span class="text-sm font-black leading-none tracking-tight">${usage}</span>
                        <span class="text-[9px] font-medium opacity-80 leading-tight mt-0.5 whitespace-nowrap">${buildRight} k-m²</span>
                    </div>
                    <div class="w-0 h-0 border-l-[6px] border-l-transparent border-r-[6px] border-r-transparent border-t-[6px] border-t-slate-900 -mt-[1px] filter drop-shadow-sm"></div>
                </div>
            `,
            iconSize: [60, 42],
            iconAnchor: [30, 42],
            popupAnchor: [0, -42]
        });
    };

    const toggleUsage = (usage: string) => {
        setFilters(prev => {
            const isSelected = prev.usage.includes(usage);
            if (isSelected) {
                return { ...prev, usage: prev.usage.filter(u => u !== usage) };
            } else {
                return { ...prev, usage: [...prev.usage, usage] };
            }
        });
    };

    if (!visible) return null;

    return (
        <>
            {/* Filter Control Panel */}
            <div className="leaflet-top leaflet-left mt-[80px] ml-[10px]" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
                <div className="bg-white p-4 rounded-xl shadow-xl border border-slate-200 text-sm w-72 backdrop-blur-sm bg-white/95">
                    <h3 className="font-bold mb-3 text-slate-800 flex justify-between items-center">
                        <span>Yritystontit</span>
                        <span className="bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full text-xs">{filteredData.length} kpl</span>
                    </h3>

                    <div className="space-y-4">
                        {/* Usage Filter (Multi-select) */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Käyttötarkoitus</label>
                            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto custom-scrollbar pr-1">
                                {usageOptions.map(opt => (
                                    <button
                                        key={opt}
                                        onClick={() => toggleUsage(opt)}
                                        className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${filters.usage.includes(opt)
                                                ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                            }`}
                                    >
                                        {opt}
                                    </button>
                                ))}
                                {usageOptions.length === 0 && <span className="text-xs text-gray-400 italic">Ei valintoja</span>}
                            </div>
                            {filters.usage.length > 0 && (
                                <button
                                    onClick={() => setFilters({ ...filters, usage: [] })}
                                    className="text-[10px] text-blue-600 hover:underline mt-1.5"
                                >
                                    Tyhjennä valinnat
                                </button>
                            )}
                        </div>

                        {/* Build Right Filter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rakennusoikeus (k-m²)</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="number" placeholder="0"
                                        className="w-full border rounded-lg px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        value={filters.minBuildRight}
                                        onChange={(e) => setFilters({ ...filters, minBuildRight: e.target.value })}
                                    />
                                    <span className="absolute right-2 top-1.5 text-[10px] text-gray-400">min</span>
                                </div>
                                <div className="relative flex-1">
                                    <input
                                        type="number" placeholder="∞"
                                        className="w-full border rounded-lg px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        value={filters.maxBuildRight}
                                        onChange={(e) => setFilters({ ...filters, maxBuildRight: e.target.value })}
                                    />
                                    <span className="absolute right-2 top-1.5 text-[10px] text-gray-400">max</span>
                                </div>
                            </div>
                        </div>

                        {/* Area Filter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Pinta-ala (m²)</label>
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input
                                        type="number" placeholder="0"
                                        className="w-full border rounded-lg px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        value={filters.minArea}
                                        onChange={(e) => setFilters({ ...filters, minArea: e.target.value })}
                                    />
                                    <span className="absolute right-2 top-1.5 text-[10px] text-gray-400">min</span>
                                </div>
                                <div className="relative flex-1">
                                    <input
                                        type="number" placeholder="∞"
                                        className="w-full border rounded-lg px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        value={filters.maxArea}
                                        onChange={(e) => setFilters({ ...filters, maxArea: e.target.value })}
                                    />
                                    <span className="absolute right-2 top-1.5 text-[10px] text-gray-400">max</span>
                                </div>
                            </div>
                        </div>

                        {loading && <div className="text-xs text-blue-600 animate-pulse font-medium text-center py-1">Päivitetään tietoja...</div>}
                    </div>
                </div>
            </div>

            {/* Polygons */}
            {filteredData.map(plot => (
                plot.geometry && (
                    <GeoJSON
                        key={`poly-${plot.id}`}
                        data={plot.geometry}
                        style={{
                            color: '#0f172a', // Slate-900 to match pins
                            weight: 2,
                            opacity: 0.8,
                            fillColor: '#3b82f6', // Blue-500
                            fillOpacity: 0.15
                        }}
                    />
                )
            ))}

            {/* Markers */}
            {filteredData.map(plot => {
                let position: [number, number] | null = null;

                if (plot.locationGeometry?.type === 'Point') {
                    const [lng, lat] = plot.locationGeometry.coordinates;
                    position = [lat, lng];
                }

                if (!position) return null;

                return (
                    <Marker
                        key={`marker-${plot.id}`}
                        position={position}
                        icon={createInfoIcon(plot.kayttotarkoitusmerkinta, plot.rakennusoikeus)}
                        eventHandlers={{
                            click: () => setSelectedPlot(plot)
                        }}
                    />
                );
            })}

            {/* Popup */}
            {selectedPlot && selectedPlot.locationGeometry?.type === 'Point' && (
                <Popup
                    position={[selectedPlot.locationGeometry.coordinates[1], selectedPlot.locationGeometry.coordinates[0]]}
                    eventHandlers={{ remove: () => setSelectedPlot(null) }}
                    className="custom-popup"
                >
                    <div className="min-w-[240px]">
                        <div className="flex items-start justify-between mb-2">
                            <h3 className="font-bold text-lg leading-tight pr-4">{selectedPlot.osoite}</h3>
                            <span className="bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 rounded font-mono border border-slate-200">{selectedPlot.kayttotarkoitusmerkinta}</span>
                        </div>

                        <div className="text-sm space-y-2">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                                <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                                    <div className="text-slate-500 uppercase text-[10px] font-semibold">Rakennusoikeus</div>
                                    <div className="font-bold text-slate-800 text-sm">{selectedPlot.rakennusoikeus} <span className="text-[10px] font-normal">k-m²</span></div>
                                </div>
                                <div className="bg-slate-50 p-1.5 rounded border border-slate-100">
                                    <div className="text-slate-500 uppercase text-[10px] font-semibold">Pinta-ala</div>
                                    <div className="font-bold text-slate-800 text-sm">{selectedPlot.pinta_ala} <span className="text-[10px] font-normal">m²</span></div>
                                </div>
                            </div>

                            <p className="border-t border-slate-100 pt-2"><span className="text-slate-500 text-xs uppercase font-semibold block mb-0.5">Käyttötarkoitus</span> {selectedPlot.kayttotarkoitus_selite}</p>

                            <p className="text-xs text-slate-500">Tunnus: <span className="font-mono text-slate-700">{selectedPlot.jhs_tunnus}</span></p>

                            {selectedPlot.lisatietoja && <p className="text-slate-600 bg-yellow-50 p-2 rounded border border-yellow-100 text-xs italic">{selectedPlot.lisatietoja}</p>}

                            <div className="text-[10px] text-slate-400 mt-2 text-right">
                                Päivitetty: {selectedPlot.paivitetty_tietopalveluun}
                            </div>
                        </div>
                    </div>
                </Popup>
            )}
        </>
    );
}
