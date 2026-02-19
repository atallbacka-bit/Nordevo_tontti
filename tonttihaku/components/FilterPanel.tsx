"use client";

import React, { useState, useEffect } from 'react';
import { ZONING_TYPES, STATUS_OPTIONS } from '@/lib/constants';
import { PlotFilters, SalesFilters, BusinessPlotFilters } from '@/types';

interface FilterState {
    laskvar_ak_min: string;
    laskvar_ak_max: string;
    laskvar_ap_min: string;
    laskvar_ap_max: string;
    laskvar_k_min: string;
    laskvar_k_max: string;
    laskvar_t_min: string;
    laskvar_t_max: string;
    laskvar_y_min: string;
    laskvar_y_max: string;
}


interface LayerStates {
    plots: boolean;
    sales: boolean;
    apartments: boolean;
    kiinteistot: boolean;
    asemakaava_info: boolean;
    korkeus: boolean;
    maapera: boolean;
    melu: boolean;
    edit_mode: boolean;
    add_plot_mode: boolean;
    sales_analysis: boolean;
    business_plots: boolean;
}

interface FilterPanelProps {
    onSearch: (filters: FilterState) => void;
    onOpacityChange: (opacity: number) => void;
    onLayerToggle: (layer: string, visible: boolean) => void;
    onKorkeusOpacityChange: (opacity: number) => void;
    layerStates: LayerStates;
    onPlotFiltersChange?: (filters: PlotFilters) => void;
    onSalesFiltersChange?: (filters: SalesFilters) => void;
    onBusinessPlotFiltersChange?: (filters: BusinessPlotFilters) => void;
    businessPlotFilters?: BusinessPlotFilters;
    visiblePlots?: any[];
    availableKunnat?: string[];
}

export default function FilterPanel({
    onSearch,
    onOpacityChange,
    onLayerToggle,
    onKorkeusOpacityChange,
    layerStates,
    onPlotFiltersChange,
    onSalesFiltersChange,
    onBusinessPlotFiltersChange,
    businessPlotFilters = { minArea: '', maxArea: '', minBuildRight: '', maxBuildRight: '', usage: [] },
    visiblePlots = [],
    availableKunnat = []
}: FilterPanelProps) {
    const [activeTab, setActiveTab] = useState<'search' | 'analysis'>('search');
    const [filters, setFilters] = useState<FilterState>({
        laskvar_ak_min: '', laskvar_ak_max: '',
        laskvar_ap_min: '', laskvar_ap_max: '',
        laskvar_k_min: '', laskvar_k_max: '',
        laskvar_t_min: '', laskvar_t_max: '',
        laskvar_y_min: '', laskvar_y_max: '',
    });
    const [opacity, setOpacity] = useState(100);
    const [korkeusOpacity, setKorkeusOpacity] = useState(70);

    // Plot filters state
    const [plotZoningTypes, setPlotZoningTypes] = useState<string[]>(ZONING_TYPES.map(z => z.code));
    const [plotBRMin, setPlotBRMin] = useState('');
    const [plotBRMax, setPlotBRMax] = useState('');
    const [plotStatus, setPlotStatus] = useState('Vapaa,Kilpailussa');
    const [plotKunnat, setPlotKunnat] = useState<string[]>([]);
    const [kuntaDropdownOpen, setKuntaDropdownOpen] = useState(false);

    // Sales filters state
    const [salesZoningTypes, setSalesZoningTypes] = useState<string[]>([]);
    const [salesBRMin, setSalesBRMin] = useState('');
    const [salesBRMax, setSalesBRMax] = useState('');

    // Update parent when plot filters change
    const updatePlotFilters = (zonings: string[], brMin: string, brMax: string, status: string, kunnat: string[]) => {
        onPlotFiltersChange?.({
            zoningTypes: zonings,
            buildingRightMin: brMin,
            buildingRightMax: brMax,
            status: status,
            kunnat: kunnat
        });
    };

    // Update parent when sales filters change
    const updateSalesFilters = (zonings: string[], brMin: string, brMax: string) => {
        onSalesFiltersChange?.({
            zoningTypes: zonings,
            buildingRightMin: brMin,
            buildingRightMax: brMax
        });
    };

    // Sync initial state on mount
    useEffect(() => {
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, plotKunnat);
    }, []);

    // Auto-select new kunnat when they appear in the data
    useEffect(() => {
        if (availableKunnat.length > 0) {
            // Find any new kunnat not yet in plotKunnat and select them
            const newKunnat = availableKunnat.filter(k => !plotKunnat.includes(k));
            if (newKunnat.length > 0 || plotKunnat.length === 0) {
                const updatedKunnat = Array.from(new Set([...plotKunnat, ...newKunnat]));
                // Also remove any that no longer exist in available
                const filtered = updatedKunnat.filter(k => availableKunnat.includes(k));
                setPlotKunnat(filtered);
                updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, filtered);
            }
        }
    }, [availableKunnat]);

    const togglePlotZoning = (code: string) => {
        let newZonings: string[];
        const allZonings = ZONING_TYPES.map(z => z.code);

        // Check if currently all are selected (or all relevant ones)
        const isAllSelected = allZonings.every(z => plotZoningTypes.includes(z));

        if (isAllSelected) {
            // "Solo" mode: if all are selected, clicking one should select ONLY that one
            newZonings = [code];
        } else {
            // Standard toggle
            newZonings = plotZoningTypes.includes(code)
                ? plotZoningTypes.filter(z => z !== code)
                : [...plotZoningTypes, code];
        }

        // If user deselects the last one, optionally deciding what to do. 
        // For now, allow empty or maybe revert to all? Let's allow empty as standard toggle behavior.

        setPlotZoningTypes(newZonings);
        updatePlotFilters(newZonings, plotBRMin, plotBRMax, plotStatus, plotKunnat);
    };

    const togglePlotKunta = (value: string) => {
        let newKunnat: string[];
        if (plotKunnat.includes(value)) {
            newKunnat = plotKunnat.filter(k => k !== value);
        } else {
            newKunnat = [...plotKunnat, value];
        }
        setPlotKunnat(newKunnat);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, newKunnat);
    };

    const toggleAllKunnat = () => {
        const allSelected = availableKunnat.every(k => plotKunnat.includes(k));
        const newKunnat = allSelected ? [] : [...availableKunnat];
        setPlotKunnat(newKunnat);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, newKunnat);
    };

    const toggleSalesZoning = (code: string) => {
        const newZonings = salesZoningTypes.includes(code)
            ? salesZoningTypes.filter(z => z !== code)
            : [...salesZoningTypes, code];
        setSalesZoningTypes(newZonings);
        updateSalesFilters(newZonings, salesBRMin, salesBRMax);
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { id, value } = e.target;
        setFilters(prev => ({ ...prev, [id]: value }));
    };

    const handleSearch = () => {
        onSearch(filters);
    };

    const handleOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        setOpacity(val);
        onOpacityChange(val / 100);
    };

    const handleKorkeusOpacityChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = parseInt(e.target.value);
        setKorkeusOpacity(val);
        onKorkeusOpacityChange(val / 100);
    };

    const toggleLayer = (layer: string, e: React.ChangeEvent<HTMLInputElement>) => {
        onLayerToggle(layer, e.target.checked);
    };

    const handleExportVisiblePlots = async () => {
        if (visiblePlots.length === 0) {
            alert('Ei näkyviä tontteja vietäväksi.');
            return;
        }
        try {
            const plotIds = visiblePlots.map((p: any) => p.id);
            const res = await fetch('/api/export-plots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ plotIds }),
            });
            if (!res.ok) throw new Error('Export failed');
            const blob = await res.blob();
            const disposition = res.headers.get('Content-Disposition');
            let filename = `tontit_export_${new Date().toISOString().split('T')[0]}.xlsx`;
            if (disposition) {
                const match = disposition.match(/filename="?([^"]+)"?/);
                if (match) filename = match[1];
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Export error:', err);
            alert('Excel-vienti epäonnistui.');
        }
    };

    return (
        <div className="w-[400px] flex-shrink-0 bg-white/95 backdrop-blur-md flex flex-col border-r border-slate-200 h-full shadow-2xl relative z-10">
            {/* Tabs */}
            <div className="flex border-b border-slate-100 px-6 pt-6 pb-2 gap-4">
                <button
                    onClick={() => setActiveTab('search')}
                    className={`flex-1 pb-2 text-center text-sm font-medium transition-all relative ${activeTab === 'search'
                        ? 'text-slate-900 border-b-2 border-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                >
                    Haku
                </button>
                <button
                    onClick={() => setActiveTab('analysis')}
                    className={`flex-1 pb-2 text-center text-sm font-medium transition-all relative ${activeTab === 'analysis'
                        ? 'text-slate-900 border-b-2 border-slate-900'
                        : 'text-slate-500 hover:text-slate-700'
                        }`}
                >
                    Analyysi
                </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto flex-grow scrollbar-thin scrollbar-thumb-slate-300">
                <h1 className="text-2xl font-bold text-slate-900 mb-1 tracking-tight">Tonttihaku</h1>
                <p className="text-sm text-slate-500 mb-6">Helsingin kaupungin tonttivaranto</p>

                {activeTab === 'search' && (
                    <div className="space-y-6">
                        {/* TUNNETUT TONTIT SECTION */}
                        <div className="bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-sm">
                            <label className="flex items-center justify-between mb-3 cursor-pointer group">
                                <div className="flex items-center gap-2">
                                    <span className="text-xl">📍</span>
                                    <h3 className="text-sm font-bold text-slate-900 group-hover:text-blue-700 transition-colors">Tunnetut tontit</h3>
                                </div>
                                <div className="relative inline-block w-10 h-6 align-middle select-none transition duration-200 ease-in">
                                    <input
                                        type="checkbox"
                                        checked={layerStates.plots}
                                        onChange={(e) => toggleLayer('plots', e)}
                                        className="toggle-checkbox absolute block w-4 h-4 rounded-full bg-white border-4 appearance-none cursor-pointer translate-x-1 top-1 transition-transform checked:translate-x-5 checked:border-blue-600"
                                    />
                                    <span className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer transition-colors ${layerStates.plots ? 'bg-blue-600' : 'bg-slate-300'}`}></span>
                                </div>
                            </label>

                            {layerStates.plots && (
                                <div className="mt-4 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                                    {/* Status Filter */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Tila</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {STATUS_OPTIONS.filter(opt => opt.value !== '').map(opt => (
                                                <label key={opt.value} className={`
                                                    flex items-center justify-center px-3 py-2 rounded-lg cursor-pointer border text-sm transition-all
                                                    ${plotStatus.includes(opt.value)
                                                        ? 'bg-white border-blue-200 text-blue-700 shadow-sm ring-1 ring-blue-100'
                                                        : 'bg-transparent border-transparent hover:bg-slate-100 text-slate-600'}
                                                `}>
                                                    <input
                                                        type="checkbox"
                                                        checked={plotStatus.includes(opt.value)}
                                                        onChange={(e) => {
                                                            let newStatus = [];
                                                            if (e.target.checked) {
                                                                newStatus = [...(plotStatus ? plotStatus.split(',') : []), opt.value];
                                                            } else {
                                                                newStatus = (plotStatus ? plotStatus.split(',') : []).filter(s => s !== opt.value);
                                                            }
                                                            const statusStr = newStatus.join(',');
                                                            setPlotStatus(statusStr);
                                                            updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, statusStr, plotKunnat);
                                                        }}
                                                        className="hidden"
                                                    />
                                                    <span className="font-medium">{opt.label}</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Kunta Filter */}
                                    <div className="relative">
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kunta</label>
                                        <button
                                            type="button"
                                            onClick={() => setKuntaDropdownOpen(!kuntaDropdownOpen)}
                                            className="w-full flex items-center justify-between px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg hover:border-slate-300 transition-all"
                                        >
                                            <span className="text-slate-700 truncate">
                                                {plotKunnat.length === 0
                                                    ? 'Ei valittuja'
                                                    : plotKunnat.length === availableKunnat.length
                                                        ? 'Kaikki kunnat'
                                                        : plotKunnat.join(', ')}
                                            </span>
                                            <span className="text-slate-400 ml-2">{kuntaDropdownOpen ? '▲' : '▼'}</span>
                                        </button>
                                        {kuntaDropdownOpen && (
                                            <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg py-1 max-h-48 overflow-y-auto">
                                                <button
                                                    type="button"
                                                    onClick={toggleAllKunnat}
                                                    className="w-full text-left px-3 py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50 border-b border-slate-100"
                                                >
                                                    {availableKunnat.every(k => plotKunnat.includes(k)) ? 'Poista kaikki' : 'Valitse kaikki'}
                                                </button>
                                                {availableKunnat.map(k => (
                                                    <label
                                                        key={k}
                                                        className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer text-sm"
                                                    >
                                                        <input
                                                            type="checkbox"
                                                            checked={plotKunnat.includes(k)}
                                                            onChange={() => togglePlotKunta(k)}
                                                            className="rounded border-slate-300 text-blue-600 mr-2"
                                                        />
                                                        {k}
                                                    </label>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* Zoning Type Filter */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Kaavatyypit</label>
                                        <div className="flex flex-wrap gap-1.5">
                                            {ZONING_TYPES.map(z => (
                                                <button
                                                    key={z.code}
                                                    type="button"
                                                    onClick={() => togglePlotZoning(z.code)}
                                                    className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-all border ${plotZoningTypes.includes(z.code)
                                                        ? 'bg-slate-800 text-white border-slate-800 shadow-sm'
                                                        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                        }`}
                                                >
                                                    {z.code}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Building Right Filter */}
                                    <div>
                                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Rakennusoikeus (k-m²)</label>
                                        <div className="flex gap-3">
                                            <div className="relative flex-1">
                                                <input
                                                    type="number"
                                                    placeholder="0"
                                                    value={plotBRMin}
                                                    onChange={(e) => {
                                                        setPlotBRMin(e.target.value);
                                                        updatePlotFilters(plotZoningTypes, e.target.value, plotBRMax, plotStatus, plotKunnat);
                                                    }}
                                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                />
                                                <span className="absolute right-3 top-2 text-xs text-slate-400">min</span>
                                            </div>
                                            <div className="relative flex-1">
                                                <input
                                                    type="number"
                                                    placeholder="∞"
                                                    value={plotBRMax}
                                                    onChange={(e) => {
                                                        setPlotBRMax(e.target.value);
                                                        updatePlotFilters(plotZoningTypes, plotBRMin, e.target.value, plotStatus, plotKunnat);
                                                    }}
                                                    className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                />
                                                <span className="absolute right-3 top-2 text-xs text-slate-400">max</span>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Add Mode Toggle */}
                                    <label className="flex items-center p-3 bg-white border border-slate-200 rounded-xl cursor-pointer hover:border-green-300 hover:bg-green-50/50 transition-all group">
                                        <div className={`w-5 h-5 rounded border flex items-center justify-center mr-3 transition-colors ${layerStates.add_plot_mode ? 'bg-green-500 border-green-500' : 'border-slate-300 bg-white'}`}>
                                            {layerStates.add_plot_mode && <svg className="w-3.5 h-3.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                        </div>
                                        <input
                                            type="checkbox"
                                            checked={layerStates.add_plot_mode}
                                            onChange={(e) => toggleLayer('add_plot_mode', e)}
                                            className="hidden"
                                        />
                                        <span className={`text-sm font-medium transition-colors ${layerStates.add_plot_mode ? 'text-green-700' : 'text-slate-600 group-hover:text-slate-800'}`}>Lisäystila (Klikkaa karttaa)</span>
                                    </label>

                                    {/* Export Button */}
                                    <button
                                        onClick={handleExportVisiblePlots}
                                        className="w-full py-2.5 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all flex items-center justify-center gap-2 shadow-sm"
                                    >
                                        <span>📥</span>
                                        <span>Lataa Excel (.xlsx)</span>
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* WMS HAKU */}
                        <div className="pt-2">
                            <h3 className="text-sm font-bold text-slate-900 mb-4 flex items-center gap-2">
                                <span>🔍</span> Etsi rakennusoikeuksia (WMS)
                            </h3>

                            <div className="space-y-4">
                                {[
                                    { id: 'laskvar_ak', label: 'Kerrostalovaranto (ak)' },
                                    { id: 'laskvar_ap', label: 'Pientalovaranto (ap)' },
                                    { id: 'laskvar_k', label: 'Liike- ja toimisto (k)' },
                                    { id: 'laskvar_t', label: 'Teollisuus ja varasto (t)' },
                                    { id: 'laskvar_y', label: 'Julkinen rakentaminen (y)' },
                                ].map((field) => (
                                    <div key={field.id} className="group">
                                        <label className="block text-xs font-medium text-slate-500 mb-1.5 group-hover:text-slate-700 transition-colors">{field.label}</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            <input type="number" id={`${field.id}_min`} placeholder="Min m²" onChange={handleInputChange}
                                                className="block w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                                            <input type="number" id={`${field.id}_max`} placeholder="Max m²" onChange={handleInputChange}
                                                className="block w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all" />
                                        </div>
                                    </div>
                                ))}

                                <button onClick={handleSearch}
                                    className="w-full mt-4 flex justify-center py-3 px-4 rounded-xl shadow-lg shadow-blue-900/10 text-sm font-bold text-white bg-slate-900 hover:bg-black focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-900 transition-all transform active:scale-[0.98]">
                                    Hae kohteet
                                </button>

                                <div className="pt-6 mt-2">
                                    <label className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
                                        <span>WMS-tason läpinäkyvyys</span>
                                        <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[10px]">{opacity}%</span>
                                    </label>
                                    <input type="range" min="0" max="100" value={opacity} onChange={handleOpacityChange}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-900" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'analysis' && (
                    <div className="space-y-4">
                        <p className="text-sm text-slate-500 mb-6 bg-blue-50/50 p-3 rounded-lg border border-blue-100/50">
                            Tutki tonttien ominaisuuksia lisäämällä analyysitasoja kartalle.
                        </p>

                        {/* Layer Toggle Component */}
                        {[
                            { id: 'sales_analysis', label: 'Myyntianalyysi', desc: 'Analysoi myyntidataa Excelistä' },
                            { id: 'business_plots', label: 'Vapaat yritystontit', desc: 'Helsingin kaupungin vapaat tontit' },
                            { id: 'kiinteistot', label: 'Kiinteistöt', desc: 'Kiinteistörajat ja -tunnukset' },
                            { id: 'asemakaava_info', label: 'Asemakaavatiedot', desc: 'Klikkaa karttaa nähdäksesi tiedot' },
                            { id: 'sales', label: 'Myydyt tontit', desc: 'Toteutuneet tonttikaupat' },
                            { id: 'apartments', label: 'Uudet asunnot', desc: 'Helsingin uusien asuntojen hinnat' },
                            { id: 'korkeus', label: 'Korkeuserot (HSY)', desc: 'Vinovalovarjoste' },
                            { id: 'maapera', label: 'Maaperäkartta (GTK)', desc: 'Maaperän laatu (20k)' },
                            { id: 'melu', label: 'Melualueet (HSY)', desc: 'Tieliikenteen melu (>55 dB)' },
                        ].map((layer) => (
                            <div key={layer.id} className={`bg-white p-4 rounded-2xl border transition-all relative ${
                                // @ts-ignore
                                layerStates[layer.id] ? 'border-blue-200 shadow-sm ring-1 ring-blue-50' : 'border-slate-200 hover:border-slate-300 shadow-sm'
                                }`}>
                                <div className="flex items-center justify-between mb-1 relative z-20">
                                    <h3 className={`text-sm font-bold ${
                                        // @ts-ignore
                                        layerStates[layer.id] ? 'text-blue-700' : 'text-slate-900'
                                        }`}>{layer.label}</h3>

                                    <div className="relative inline-block w-9 h-5 align-middle select-none group-hover:scale-105 transition-transform pointer-events-none">
                                        <input
                                            type="checkbox"
                                            // @ts-ignore
                                            checked={layerStates[layer.id]}
                                            readOnly
                                            className="toggle-checkbox absolute block w-3.5 h-3.5 rounded-full bg-white border-2 appearance-none translate-x-0.5 top-0.5 transition-transform checked:translate-x-4 checked:border-blue-600 z-10"
                                        />
                                        <div className={`toggle-label block overflow-hidden h-5 rounded-full transition-colors ${
                                            // @ts-ignore
                                            layerStates[layer.id] ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                        ></div>
                                    </div>
                                    {/* Overlay for hit area - constrained to this layer's container */}
                                    <label className="absolute inset-0 cursor-pointer z-0">
                                        <input
                                            type="checkbox"
                                            // @ts-ignore
                                            checked={layerStates[layer.id]}
                                            // @ts-ignore
                                            onChange={(e) => toggleLayer(layer.id, e)}
                                            className="hidden"
                                        />
                                    </label>
                                </div>
                                <p className="text-xs text-slate-500 relative z-10 pointer-events-none">{layer.desc}</p>

                                {/* Business Plots Filters */}
                                {layer.id === 'business_plots' && layerStates.business_plots && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 animate-in fade-in duration-300 relative z-30">
                                        {/* Usage Filter (Multi-select) */}
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Käyttötarkoitus</label>
                                            <div className="flex flex-wrap gap-1.5 pr-1">
                                                {/* We need to get available usage options somehow. 
                                                    Ideally passed from parent or extracted from data. 
                                                    For now, let's assume we can pass options or hardcode common ones, 
                                                    BUT actually the options were derived from data in BusinessPlotsLayer.
                                                    We should probably pass availableOptions from BusinessPlotsLayer UP to MapComponent and then DOWN here.
                                                    OR, simpler: just let user type or have BusinessPlotsLayer update a state in MapComponent with available options.
                                                    Let's use a standard list for now + "Muu".
                                                    Actually, let's fix this properly in next step. For now, render standard buttons.
                                                */}
                                                {/* For now, just render input filters as they are easier without data dependency */}
                                                <p className="text-xs text-slate-400 italic">Suodattimet siirretty tänne...</p>
                                            </div>
                                        </div>

                                        {/* Build Right Filter */}
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Rakennusoikeus (k-m²)</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="number" placeholder="Min"
                                                    value={businessPlotFilters.minBuildRight}
                                                    onChange={(e) => onBusinessPlotFiltersChange?.({ ...businessPlotFilters, minBuildRight: e.target.value })}
                                                    className="w-full border rounded px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                                <input
                                                    type="number" placeholder="Max"
                                                    value={businessPlotFilters.maxBuildRight}
                                                    onChange={(e) => onBusinessPlotFiltersChange?.({ ...businessPlotFilters, maxBuildRight: e.target.value })}
                                                    className="w-full border rounded px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                        {/* Area Filter */}
                                        <div>
                                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Pinta-ala (m²)</label>
                                            <div className="flex gap-2">
                                                <input
                                                    type="number" placeholder="Min"
                                                    value={businessPlotFilters.minArea}
                                                    onChange={(e) => onBusinessPlotFiltersChange?.({ ...businessPlotFilters, minArea: e.target.value })}
                                                    className="w-full border rounded px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                                <input
                                                    type="number" placeholder="Max"
                                                    value={businessPlotFilters.maxArea}
                                                    onChange={(e) => onBusinessPlotFiltersChange?.({ ...businessPlotFilters, maxArea: e.target.value })}
                                                    className="w-full border rounded px-2 py-1.5 text-xs bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* Extra controls for specific layers */}
                                {layer.id === 'korkeus' && layerStates.korkeus && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 relative z-30">
                                        <div className="flex items-center gap-3">
                                            <input type="range" min="0" max="100" value={korkeusOpacity} onChange={handleKorkeusOpacityChange}
                                                className="flex-1 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-slate-600" />
                                            <span className="text-xs font-mono text-slate-500 w-8 text-right">{korkeusOpacity}%</span>
                                        </div>
                                    </div>
                                )}

                                {layer.id === 'sales' && layerStates.sales && (
                                    <div className="mt-3 pt-3 border-t border-slate-100 space-y-4 animate-in fade-in duration-300 relative z-30">
                                        {/* Sales Filters */}
                                        <div className="flex flex-wrap gap-1.5">
                                            {ZONING_TYPES.map(z => (
                                                <button
                                                    key={z.code}
                                                    type="button"
                                                    onClick={() => toggleSalesZoning(z.code)}
                                                    className={`px-2 py-1 text-[10px] font-bold rounded border uppercase ${salesZoningTypes.includes(z.code)
                                                        ? 'bg-slate-800 text-white border-slate-800'
                                                        : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                                                        }`}
                                                >
                                                    {z.code}
                                                </button>
                                            ))}
                                        </div>
                                        <div className="flex gap-2">
                                            <input type="number" placeholder="Min m²" value={salesBRMin} onChange={(e) => {
                                                setSalesBRMin(e.target.value);
                                                updateSalesFilters(salesZoningTypes, e.target.value, salesBRMax);
                                            }} className="w-1/2 px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                                            <input type="number" placeholder="Max m²" value={salesBRMax} onChange={(e) => {
                                                setSalesBRMax(e.target.value);
                                                updateSalesFilters(salesZoningTypes, salesBRMin, e.target.value);
                                            }} className="w-1/2 px-2 py-1.5 text-xs border border-slate-200 rounded bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20" />
                                        </div>

                                        <label className="flex items-center p-2 bg-red-50 border border-red-100 rounded-lg cursor-pointer hover:bg-red-100 transition-colors">
                                            <input type="checkbox" checked={layerStates.edit_mode} onChange={(e) => toggleLayer('edit_mode', e)} className="hidden" />
                                            <span className={`w-4 h-4 rounded border flex items-center justify-center mr-2 ${layerStates.edit_mode ? 'bg-red-500 border-red-500' : 'bg-white border-red-300'}`}>
                                                {layerStates.edit_mode && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                            </span>
                                            <span className="text-xs font-bold text-red-700">Muokkaustila</span>
                                        </label>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
