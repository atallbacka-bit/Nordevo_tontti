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
        usage: '' // käyttötarkoitusmerkinta
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
            if (filters.usage && usage !== filters.usage) return false;

            return true;
        });
    }, [data, filters]);

    // Custom Icon for Pins
    const createInfoIcon = (usage: string, buildRight: string) => {
        return L.divIcon({
            className: 'custom-info-marker',
            html: `
                <div class="bg-white border-2 border-blue-600 rounded shadow-md text-xs font-bold text-center flex flex-col items-center justify-center p-1" style="min-width: 60px;">
                    <span class="text-blue-700 leading-tight">${usage}</span>
                    <span class="text-gray-600 text-[10px] leading-tight">${buildRight} k-m²</span>
                </div>
            `,
            iconSize: [60, 36],
            iconAnchor: [30, 36] // Anchor at bottom center
        });
    };

    if (!visible) return null;

    return (
        <>
            {/* Filter Control Panel */}
            <div className="leaflet-top leaflet-left mt-[80px] ml-[10px]" style={{ pointerEvents: 'auto', zIndex: 1000 }}>
                <div className="bg-white p-3 rounded shadow-lg border border-slate-200 text-sm max-w-xs">
                    <h3 className="font-bold mb-2 text-slate-800">Yritystontit ({filteredData.length})</h3>

                    <div className="space-y-2">
                        {/* Usage Filter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600">Käyttötarkoitus</label>
                            <select
                                className="w-full border rounded px-2 py-1 bg-slate-50 text-xs"
                                value={filters.usage}
                                onChange={(e) => setFilters({ ...filters, usage: e.target.value })}
                            >
                                <option value="">Kaikki</option>
                                {usageOptions.map(opt => (
                                    <option key={opt} value={opt}>{opt}</option>
                                ))}
                            </select>
                        </div>

                        {/* Build Right Filter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600">Rakennusoikeus (k-m²)</label>
                            <div className="flex gap-1">
                                <input
                                    type="number" placeholder="Min"
                                    className="w-1/2 border rounded px-1 py-1 text-xs"
                                    value={filters.minBuildRight}
                                    onChange={(e) => setFilters({ ...filters, minBuildRight: e.target.value })}
                                />
                                <input
                                    type="number" placeholder="Max"
                                    className="w-1/2 border rounded px-1 py-1 text-xs"
                                    value={filters.maxBuildRight}
                                    onChange={(e) => setFilters({ ...filters, maxBuildRight: e.target.value })}
                                />
                            </div>
                        </div>

                        {/* Area Filter */}
                        <div>
                            <label className="block text-xs font-semibold text-slate-600">Pinta-ala (m²)</label>
                            <div className="flex gap-1">
                                <input
                                    type="number" placeholder="Min"
                                    className="w-1/2 border rounded px-1 py-1 text-xs"
                                    value={filters.minArea}
                                    onChange={(e) => setFilters({ ...filters, minArea: e.target.value })}
                                />
                                <input
                                    type="number" placeholder="Max"
                                    className="w-1/2 border rounded px-1 py-1 text-xs"
                                    value={filters.maxArea}
                                    onChange={(e) => setFilters({ ...filters, maxArea: e.target.value })}
                                />
                            </div>
                        </div>

                        {loading && <div className="text-xs text-blue-500 animate-pulse">Ladataan tietoja...</div>}
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
                            color: '#2563eb', // Blue-600
                            weight: 2,
                            opacity: 0.6,
                            fillOpacity: 0.1
                        }}
                    />
                )
            ))}

            {/* Markers */}
            {filteredData.map(plot => {
                // Determine marker position: use locationGeometry (Point) if available, or try to compute centroid from polygon?
                // WFS response gave us specific Point geometry, so let's use that.
                // GeoJSON Point coordinates are [lng, lat]. Leaflet needs [lat, lng].
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
                >
                    <div className="min-w-[200px]">
                        <h3 className="font-bold text-lg mb-1">{selectedPlot.osoite}</h3>
                        <div className="text-sm space-y-1">
                            <p><span className="font-semibold">Käyttötarkoitus:</span> {selectedPlot.kayttotarkoitusmerkinta} ({selectedPlot.kayttotarkoitus_selite})</p>
                            <p><span className="font-semibold">Rakennusoikeus:</span> {selectedPlot.rakennusoikeus} k-m²</p>
                            <p><span className="font-semibold">Pinta-ala:</span> {selectedPlot.pinta_ala} m²</p>
                            <p><span className="font-semibold">Tunnus:</span> {selectedPlot.jhs_tunnus}</p>
                            {selectedPlot.lisatietoja && <p className="text-gray-600 italic mt-2">{selectedPlot.lisatietoja}</p>}
                            <div className="text-xs text-gray-400 mt-2 border-t pt-1">
                                Päivitetty: {selectedPlot.paivitetty_tietopalveluun}
                            </div>
                        </div>
                    </div>
                </Popup>
            )}
        </>
    );
}
