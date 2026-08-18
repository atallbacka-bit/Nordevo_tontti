"use client";

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ZONING_TYPES, STATUS_OPTIONS, MATERIAL_OPTIONS, getStatusAccent } from '@/lib/constants';
import { PlotData, PlotFilters, SalesFilters, BusinessPlotFilters } from '@/types';

// iOS-style switch, visual only — pair with a hidden checkbox input
function Switch({ on }: { on: boolean }) {
    return (
        <span className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${on ? 'bg-blue-600' : 'bg-slate-300'}`}>
            <span className={`h-3.5 w-3.5 rounded-full bg-white shadow-sm transform transition-transform ${on ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
        </span>
    );
}

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
    add_past_plot_mode?: boolean;
    sales_analysis?: boolean;
    business_plots: boolean;
}

interface FilterPanelProps {
    isOpen?: boolean;
    onToggle?: () => void;
    onSearch: (filters: FilterState) => void;
    onOpacityChange: (opacity: number) => void;
    onLayerToggle: (layer: string, visible: boolean) => void;
    onKorkeusOpacityChange: (opacity: number) => void;
    layerStates: LayerStates;
    onPlotFiltersChange?: (filters: PlotFilters) => void;
    onSalesFiltersChange?: (filters: SalesFilters) => void;
    onBusinessPlotFiltersChange?: (filters: BusinessPlotFilters) => void;
    businessPlotFilters?: BusinessPlotFilters;
    businessUsageOptions?: string[];
    visiblePlots?: any[];
    availableKunnat?: string[];
    plotsData?: PlotData[];
    onPlotSelect?: (plot: PlotData | null) => void;
}

export default function FilterPanel({
    isOpen = true,
    onToggle,
    onSearch,
    onOpacityChange,
    onLayerToggle,
    onKorkeusOpacityChange,
    layerStates,
    onPlotFiltersChange,
    onSalesFiltersChange,
    onBusinessPlotFiltersChange,
    businessPlotFilters = { minArea: '', maxArea: '', minBuildRight: '', maxBuildRight: '', usage: [] },
    businessUsageOptions = [],
    visiblePlots = [],
    availableKunnat = [],
    plotsData = [],
    onPlotSelect
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
    const [plotStatus, setPlotStatus] = useState('Vapaa,Kilpailussa,Tarjottu,Pidossa');
    const [plotKunnat, setPlotKunnat] = useState<string[]>([]);
    const [plotPriorities, setPlotPriorities] = useState<number[]>([]);
    const [plotMaterials, setPlotMaterials] = useState<string[]>([]);
    const [kuntaDropdownOpen, setKuntaDropdownOpen] = useState(false);

    // Plot search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchRef = useRef<HTMLDivElement>(null);

    // Close search dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
                setSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Compute search results
    const searchResults = useMemo(() => {
        if (!searchQuery || searchQuery.length < 2) return [];
        const q = searchQuery.toLowerCase();
        return plotsData.filter(plot => {
            if (plot.name?.toLowerCase().includes(q)) return true;
            if (plot.address?.toLowerCase().includes(q)) return true;
            if (plot.seller?.toLowerCase().includes(q)) return true;
            if (plot.kunta?.toLowerCase().includes(q)) return true;
            if (plot.kiinteistotunnus?.toLowerCase().includes(q)) return true;
            if (plot.contactPerson?.toLowerCase().includes(q)) return true;
            // Search in contactPersons JSON
            if (plot.contactPersons) {
                try {
                    const persons = typeof plot.contactPersons === 'string' ? JSON.parse(plot.contactPersons) : plot.contactPersons;
                    if (Array.isArray(persons) && persons.some((p: any) =>
                        p.name?.toLowerCase().includes(q) ||
                        p.phone?.toLowerCase().includes(q) ||
                        p.email?.toLowerCase().includes(q)
                    )) return true;
                } catch { }
            }
            return false;
        }).slice(0, 10);
    }, [searchQuery, plotsData]);

    // Sales filters state
    const [salesZoningTypes, setSalesZoningTypes] = useState<string[]>([]);
    const [salesBRMin, setSalesBRMin] = useState('');
    const [salesBRMax, setSalesBRMax] = useState('');

    // Update parent when plot filters change
    const updatePlotFilters = (zonings: string[], brMin: string, brMax: string, status: string, kunnat: string[], priorities: number[], materials: string[]) => {
        onPlotFiltersChange?.({
            zoningTypes: zonings,
            buildingRightMin: brMin,
            buildingRightMax: brMax,
            status: status,
            kunnat: kunnat,
            priorities: priorities,
            materials: materials
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
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, plotKunnat, plotPriorities, plotMaterials);
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
                updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, filtered, plotPriorities, plotMaterials);
            }
        }
    }, [availableKunnat]);

    const togglePlotPriority = (priority: number) => {
        let newPriorities: number[];
        if (plotPriorities.includes(priority)) {
            newPriorities = plotPriorities.filter(p => p !== priority);
        } else {
            newPriorities = [...plotPriorities, priority];
        }
        setPlotPriorities(newPriorities);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, plotKunnat, newPriorities, plotMaterials);
    };

    const togglePlotMaterial = (value: string) => {
        let newMaterials: string[];
        if (plotMaterials.includes(value)) {
            newMaterials = plotMaterials.filter(m => m !== value);
        } else {
            newMaterials = [...plotMaterials, value];
        }
        setPlotMaterials(newMaterials);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, plotKunnat, plotPriorities, newMaterials);
    };

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
        updatePlotFilters(newZonings, plotBRMin, plotBRMax, plotStatus, plotKunnat, plotPriorities, plotMaterials);
    };

    const togglePlotKunta = (value: string) => {
        let newKunnat: string[];
        if (plotKunnat.includes(value)) {
            newKunnat = plotKunnat.filter(k => k !== value);
        } else {
            newKunnat = [...plotKunnat, value];
        }
        setPlotKunnat(newKunnat);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, newKunnat, plotPriorities, plotMaterials);
    };

    const toggleAllKunnat = () => {
        const allSelected = availableKunnat.every(k => plotKunnat.includes(k));
        const newKunnat = allSelected ? [] : [...availableKunnat];
        setPlotKunnat(newKunnat);
        updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, plotStatus, newKunnat, plotPriorities, plotMaterials);
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
        <>
            {/* Mobile overlay */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/20 backdrop-blur-sm z-[999] md:hidden transition-opacity duration-300"
                    onClick={onToggle}
                />
            )}

            {/* Panel */}
            <div className={`
                fixed md:relative left-0 top-0
                w-[85vw] sm:w-[350px] md:w-[400px]
                h-full
                flex-shrink-0 bg-white flex flex-col border-r border-slate-200 shadow-2xl z-[1000]
                transition-all duration-300 ease-in-out
                ${isOpen ? 'translate-x-0 ml-0' : '-translate-x-full md:-ml-[400px] shadow-none'}
            `}>
                {/* Close button for panel */}
                <div className="absolute top-5 right-5 z-50">
                    <button
                        onClick={onToggle}
                        className="p-1.5 bg-slate-100 rounded-full text-slate-500 hover:text-slate-800 hover:bg-slate-200 transition-colors shadow-sm border border-slate-200"
                        title="Piilota valikko"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
                        </svg>
                    </button>
                </div>

                {/* Header + tabs */}
                <div className="px-5 pt-5 pb-4 border-b border-slate-100">
                    <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-tight">Tonttihaku</h1>
                    <p className="text-xs text-slate-500 mb-3.5">Pääkaupunkiseudun tonttivaranto</p>
                    <div className="flex bg-slate-100 rounded-lg p-1 mr-10">
                        <button
                            onClick={() => setActiveTab('search')}
                            className={`flex-1 py-1.5 text-center text-[13px] font-semibold rounded-md transition-all ${activeTab === 'search'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Haku
                        </button>
                        <button
                            onClick={() => setActiveTab('analysis')}
                            className={`flex-1 py-1.5 text-center text-[13px] font-semibold rounded-md transition-all ${activeTab === 'analysis'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-500 hover:text-slate-700'
                                }`}
                        >
                            Analyysi
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="px-5 py-5 overflow-y-auto flex-grow">

                    {activeTab === 'search' && (
                        <div className="space-y-6">
                            {/* TUNNETUT TONTIT SECTION */}
                            <div>
                                <label className="flex items-center justify-between cursor-pointer group">
                                    <h3 className="text-sm font-semibold text-slate-900">Tunnetut tontit</h3>
                                    <input
                                        type="checkbox"
                                        checked={layerStates.plots}
                                        onChange={(e) => toggleLayer('plots', e)}
                                        className="hidden"
                                    />
                                    <Switch on={layerStates.plots} />
                                </label>

                                {layerStates.plots && (
                                    <div className="mt-4 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">
                                        {/* Plot Search Bar */}
                                        <div ref={searchRef} className="relative">
                                            <div className="relative">
                                                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" />
                                                </svg>
                                                <input
                                                    type="text"
                                                    placeholder="Etsi tontteja..."
                                                    value={searchQuery}
                                                    onChange={(e) => {
                                                        setSearchQuery(e.target.value);
                                                        setSearchOpen(e.target.value.length >= 2);
                                                        // Any edit to the text clears the active selection bypass
                                                        onPlotSelect?.(null);
                                                    }}
                                                    onFocus={() => { if (searchQuery.length >= 2) setSearchOpen(true); }}
                                                    onKeyDown={(e) => { if (e.key === 'Escape') { setSearchOpen(false); (e.target as HTMLInputElement).blur(); } }}
                                                    className="w-full pl-9 pr-8 py-2 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all placeholder:text-slate-400"
                                                />
                                                {searchQuery && (
                                                    <button
                                                        onClick={() => { setSearchQuery(''); setSearchOpen(false); onPlotSelect?.(null); }}
                                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-sm"
                                                    >✕</button>
                                                )}
                                            </div>
                                            {searchOpen && searchResults.length > 0 && (
                                                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-1 max-h-72 overflow-y-auto">
                                                    {searchResults.map(plot => (
                                                        <button
                                                            key={plot.id}
                                                            onClick={() => {
                                                                onPlotSelect?.(plot);
                                                                setSearchQuery(plot.name || '');
                                                                setSearchOpen(false);
                                                            }}
                                                            className="w-full text-left px-3 py-2.5 hover:bg-slate-50 transition-colors border-b border-slate-50 last:border-b-0"
                                                        >
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-sm font-semibold text-slate-800 truncate">{plot.name}</span>
                                                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full flex-shrink-0 ml-2 ${plot.status === 'Vapaa' ? 'bg-blue-50 text-blue-600' :
                                                                    plot.status === 'Kilpailussa' ? 'bg-red-50 text-red-600' :
                                                                        plot.status === 'Tarjottu' ? 'bg-green-50 text-green-600' :
                                                                            plot.status === 'Pidossa' ? 'bg-purple-50 text-purple-600' :
                                                                                plot.status === 'Mennyt' ? 'bg-gray-100 text-gray-500' :
                                                                                    'bg-slate-100 text-slate-500'
                                                                    }`}>{plot.status}</span>
                                                            </div>
                                                            {plot.address && <div className="text-xs text-slate-500 truncate">{plot.address}</div>}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {searchOpen && searchQuery.length >= 2 && searchResults.length === 0 && (
                                                <div className="absolute z-50 mt-1 w-full bg-white border border-slate-200 rounded-xl shadow-lg py-3 px-4 text-sm text-slate-400 text-center">
                                                    Ei tuloksia haulle &ldquo;{searchQuery}&rdquo;
                                                </div>
                                            )}
                                        </div>
                                        {/* Status Filter */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Tila</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {STATUS_OPTIONS.filter(opt => opt.value !== '').map(opt => {
                                                    const isSelected = plotStatus.includes(opt.value);
                                                    const accent = getStatusAccent(opt.value);

                                                    let selectedClasses = 'bg-blue-50 border-blue-300 text-blue-800';
                                                    switch (opt.value) {
                                                        case 'Vapaa': selectedClasses = 'bg-blue-50 border-blue-300 text-blue-800'; break;
                                                        case 'Kilpailussa': selectedClasses = 'bg-red-50 border-red-300 text-red-800'; break;
                                                        case 'Tarjottu': selectedClasses = 'bg-green-50 border-green-300 text-green-800'; break;
                                                        case 'Mennyt': selectedClasses = 'bg-slate-100 border-slate-300 text-slate-700'; break;
                                                        case 'Pidossa': selectedClasses = 'bg-purple-50 border-purple-300 text-purple-800'; break;
                                                    }

                                                    return (
                                                        <label key={opt.value} className={`
                                                            inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full cursor-pointer border text-xs font-semibold transition-all
                                                            ${isSelected ? selectedClasses : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300 hover:text-slate-700'}
                                                        `}>
                                                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: accent, opacity: isSelected ? 1 : 0.4 }} />
                                                            <input
                                                                type="checkbox"
                                                                checked={isSelected}
                                                                onChange={(e) => {
                                                                    let newStatus = [];
                                                                    if (e.target.checked) {
                                                                        newStatus = [...(plotStatus ? plotStatus.split(',') : []), opt.value];
                                                                    } else {
                                                                        newStatus = (plotStatus ? plotStatus.split(',') : []).filter(s => s !== opt.value);
                                                                    }
                                                                    const statusStr = newStatus.join(',');
                                                                    setPlotStatus(statusStr);
                                                                    updatePlotFilters(plotZoningTypes, plotBRMin, plotBRMax, statusStr, plotKunnat, plotPriorities, plotMaterials);
                                                                }}
                                                                className="hidden"
                                                            />
                                                            {opt.label}
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </div>

                                        {/* Kunta Filter */}
                                        <div className="relative">
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Kunta</label>
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
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Kaavatyypit</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {ZONING_TYPES.map(z => {
                                                    const isSelected = plotZoningTypes.includes(z.code);
                                                    return (
                                                        <button
                                                            key={z.code}
                                                            type="button"
                                                            onClick={() => togglePlotZoning(z.code)}
                                                            title={z.label}
                                                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-full transition-all border ${isSelected
                                                                ? ''
                                                                : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300 hover:text-slate-700'
                                                                }`}
                                                            style={isSelected
                                                                ? { background: `${z.color}14`, borderColor: `${z.color}59`, color: z.color }
                                                                : undefined}
                                                        >
                                                            <span className="w-2 h-2 rounded-full flex-none" style={{ background: z.color, opacity: isSelected ? 1 : 0.4 }} />
                                                            {z.code}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* Priority Filter */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Prioriteetti</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[1, 2, 3, 0].map(p => (
                                                    <button
                                                        key={p}
                                                        type="button"
                                                        onClick={() => togglePlotPriority(p)}
                                                        className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all border ${plotPriorities.includes(p)
                                                            ? 'bg-slate-900 text-white border-slate-900'
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                            }`}
                                                    >
                                                        {p === 0 ? '-' : p}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Material Filter (Puu/Betoni) */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Materiaali</label>
                                            <div className="flex flex-wrap gap-1.5">
                                                {[...MATERIAL_OPTIONS, { value: '', label: '-' }].map(m => (
                                                    <button
                                                        key={m.value || 'none'}
                                                        type="button"
                                                        onClick={() => togglePlotMaterial(m.value)}
                                                        className={`px-3 py-1.5 text-xs font-semibold rounded-full transition-all border ${plotMaterials.includes(m.value)
                                                            ? (m.value === 'Puu'
                                                                ? 'bg-amber-700 text-white border-amber-700 shadow-sm'
                                                                : 'bg-slate-900 text-white border-slate-900')
                                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                            }`}
                                                    >
                                                        {m.label}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Building Right Filter */}
                                        <div>
                                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Rakennusoikeus (k-m²)</label>
                                            <div className="flex gap-3">
                                                <div className="relative flex-1">
                                                    <input
                                                        type="number"
                                                        placeholder="0"
                                                        value={plotBRMin}
                                                        onChange={(e) => {
                                                            setPlotBRMin(e.target.value);
                                                            updatePlotFilters(plotZoningTypes, e.target.value, plotBRMax, plotStatus, plotKunnat, plotPriorities, plotMaterials);
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
                                                            updatePlotFilters(plotZoningTypes, plotBRMin, e.target.value, plotStatus, plotKunnat, plotPriorities, plotMaterials);
                                                        }}
                                                        className="w-full px-3 py-2 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                                    />
                                                    <span className="absolute right-3 top-2 text-xs text-slate-400">max</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Add Mode Toggle */}
                                        <div className="border-t border-slate-100 pt-3.5 space-y-2.5">
                                            <label className="flex items-center gap-2.5 cursor-pointer group">
                                                <div className={`w-[18px] h-[18px] rounded border flex items-center justify-center transition-colors ${layerStates.add_plot_mode ? 'bg-green-600 border-green-600' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
                                                    {layerStates.add_plot_mode && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                                </div>
                                                <input
                                                    type="checkbox"
                                                    checked={layerStates.add_plot_mode}
                                                    onChange={(e) => toggleLayer('add_plot_mode', e)}
                                                    className="hidden"
                                                />
                                                <span className={`text-[13px] font-medium transition-colors ${layerStates.add_plot_mode ? 'text-green-700' : 'text-slate-600 group-hover:text-slate-800'}`}>Lisäystila — klikkaa karttaa</span>
                                            </label>

                                            {/* Add Past Plot Mode Sub-Toggle */}
                                            {layerStates.add_plot_mode && (
                                                <label className="flex items-center gap-2.5 pl-7 cursor-pointer group">
                                                    <div className={`w-[16px] h-[16px] rounded border flex items-center justify-center transition-colors ${layerStates.add_past_plot_mode ? 'bg-blue-600 border-blue-600' : 'border-slate-300 bg-white group-hover:border-slate-400'}`}>
                                                        {layerStates.add_past_plot_mode && <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                                                    </div>
                                                    <input
                                                        type="checkbox"
                                                        checked={!!layerStates.add_past_plot_mode}
                                                        onChange={(e) => toggleLayer('add_past_plot_mode', e)}
                                                        className="hidden"
                                                    />
                                                    <span className={`text-xs font-medium transition-colors ${layerStates.add_past_plot_mode ? 'text-blue-700' : 'text-slate-500'}`}>Menneen tontin lisäys</span>
                                                </label>
                                            )}

                                            {/* Export Button */}
                                            <button
                                                onClick={handleExportVisiblePlots}
                                                className="w-full py-2 px-4 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 hover:border-slate-300 hover:text-slate-900 transition-all flex items-center justify-center gap-2"
                                            >
                                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0 0l-4-4m4 4l4-4" />
                                                </svg>
                                                <span>Lataa Excel (.xlsx)</span>
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* WMS HAKU */}
                            <div className="border-t border-slate-100 pt-5">
                                <h3 className="text-sm font-semibold text-slate-900 mb-1">Etsi rakennusoikeuksia</h3>
                                <p className="text-xs text-slate-500 mb-4">Korttelitason varantohaku (WMS)</p>

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
                                        className="w-full mt-4 flex justify-center py-2.5 px-4 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-all active:scale-[0.99]">
                                        Hae kohteet
                                    </button>

                                    <div className="pt-6 mt-2">
                                        <label className="flex items-center justify-between text-xs font-medium text-slate-500 mb-2">
                                            <span>WMS-tason läpinäkyvyys</span>
                                            <span className="text-slate-900 bg-slate-100 px-2 py-0.5 rounded text-[10px]">{opacity}%</span>
                                        </label>
                                        <input type="range" min="0" max="100" value={opacity} onChange={handleOpacityChange}
                                            className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600" />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'analysis' && (
                        <div>
                            <p className="text-xs text-slate-500 mb-3">
                                Tutki tonttien ominaisuuksia lisäämällä analyysitasoja kartalle.
                            </p>

                            {/* Layer Toggle Component */}
                            <div className="divide-y divide-slate-100">
                            {[
                                { id: 'sales_analysis', label: 'Uudiskohteiden myyntidata (STH)', desc: 'Analysoi myyntidataa Excelistä' },
                                { id: 'business_plots', label: 'Vapaat yritystontit', desc: 'Helsingin ja Espoon vapaat tontit' },
                                { id: 'kiinteistot', label: 'Kiinteistöt', desc: 'Kiinteistörajat ja -tunnukset' },
                                { id: 'asemakaava_info', label: 'Asemakaavatiedot', desc: 'Klikkaa karttaa nähdäksesi tiedot' },
                                { id: 'sales', label: 'Myydyt tontit', desc: 'Toteutuneet tonttikaupat' },
                                { id: 'apartments', label: 'Uudet asunnot', desc: 'Helsingin uusien asuntojen hinnat' },
                                { id: 'korkeus', label: 'Korkeuserot (HSY)', desc: 'Vinovalovarjoste' },
                                { id: 'maapera', label: 'Maaperäkartta (GTK)', desc: 'Maaperän laatu (20k)' },
                                { id: 'melu', label: 'Melualueet (HSY)', desc: 'Tieliikenteen melu (>55 dB)' },
                            ].map((layer) => (
                                <div key={layer.id} className="relative py-3 transition-colors">
                                    <div className="flex items-center justify-between relative z-20 pointer-events-none">
                                        <h3 className={`text-[13px] font-semibold ${
                                            // @ts-ignore
                                            layerStates[layer.id] ? 'text-blue-700' : 'text-slate-800'
                                            }`}>{layer.label}</h3>

                                        <Switch on={
                                            // @ts-ignore
                                            !!layerStates[layer.id]
                                        } />
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
                                    <p className="text-xs text-slate-500 mt-0.5 relative z-10 pointer-events-none">{layer.desc}</p>

                                    {/* Sales Analysis Portal Container */}
                                    {layer.id === 'sales_analysis' && layerStates.sales_analysis && (
                                        <div id="sales-analysis-filters-container" className="mt-3 pt-3 border-t border-slate-100 space-y-3 animate-in fade-in duration-300 relative z-30">
                                        </div>
                                    )}

                                    {/* Business Plots Filters */}
                                    {layer.id === 'business_plots' && layerStates.business_plots && (
                                        <div className="mt-3 pt-3 border-t border-slate-100 space-y-3 animate-in fade-in duration-300 relative z-30">
                                            {/* Usage Filter (Multi-select) */}
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-2">Käyttötarkoitus</label>
                                                <div className="flex flex-wrap gap-1.5 pr-1 max-h-32 overflow-y-auto custom-scrollbar">
                                                    {businessUsageOptions.map(opt => (
                                                        <button
                                                            key={opt}
                                                            onClick={() => {
                                                                const currentUsage = businessPlotFilters.usage || [];
                                                                const isSelected = currentUsage.includes(opt);
                                                                const newUsage = isSelected
                                                                    ? currentUsage.filter(u => u !== opt)
                                                                    : [...currentUsage, opt];
                                                                onBusinessPlotFiltersChange?.({ ...businessPlotFilters, usage: newUsage });
                                                            }}
                                                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-all ${businessPlotFilters.usage?.includes(opt)
                                                                ? 'bg-slate-900 text-white border-slate-900'
                                                                : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                                                }`}
                                                        >
                                                            {opt}
                                                        </button>
                                                    ))}
                                                    {businessUsageOptions.length === 0 && <span className="text-xs text-gray-400 italic">Ladataan...</span>}
                                                </div>
                                                {businessPlotFilters.usage && businessPlotFilters.usage.length > 0 && (
                                                    <button
                                                        onClick={() => onBusinessPlotFiltersChange?.({ ...businessPlotFilters, usage: [] })}
                                                        className="text-[10px] text-blue-600 hover:underline mt-1.5"
                                                    >
                                                        Tyhjennä valinnat
                                                    </button>
                                                )}
                                            </div>

                                            {/* Build Right Filter */}
                                            <div>
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-1">Rakennusoikeus (k-m²)</label>
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
                                                <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em] mb-1">Pinta-ala (m²)</label>
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
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
