"use client";

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface SalesDataModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: any;
}

// Chart Components
const PieChart = ({ value, total, color = "bg-blue-600", label }: { value: number, total: number, color?: string, label?: string }) => {
    const percentage = total > 0 ? (value / total) * 100 : 0;
    const safePercent = Math.min(100, Math.max(0, percentage));

    // Tailwind colors to hex for conic gradient
    const hexColor = color.includes('emerald') ? '#10b981' : color.includes('blue') ? '#2563eb' : '#f59e0b';

    return (
        <div className="flex flex-col items-center">
            <div className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-sm border border-slate-100"
                style={{
                    background: `conic-gradient(${hexColor} ${safePercent}%, #f1f5f9 0)`
                }}
            >
                <div className="w-16 h-16 bg-white rounded-full flex flex-col items-center justify-center text-xs text-gray-700 shadow-inner">
                    <span className="font-bold">{value}</span>
                    <span className="text-[10px] text-gray-400">/ {total}</span>
                </div>
            </div>
            {label && <span className="mt-2 text-xs font-medium text-slate-600 text-center">{label}</span>}
        </div>
    );
};

// Stacked Bar for Units
const UnitBar = ({ type, sold, unsold }: { type: string, sold: number, unsold: number }) => {
    const total = sold + unsold;
    if (total === 0) return null;

    const soldPct = (sold / total) * 100;

    return (
        <div className="flex flex-col gap-1 min-w-[60px]">
            <div className="h-24 w-full bg-slate-100 rounded-t-lg relative flex flex-col-reverse overflow-hidden">
                <div style={{ height: `${soldPct}%` }} className="w-full bg-blue-500 transition-all duration-500" title={`Myyty: ${sold}`} />
                <div style={{ height: `${100 - soldPct}%` }} className="w-full bg-orange-300 transition-all duration-500" title={`Vapaa: ${unsold}`} />
            </div>
            <div className="text-center">
                <div className="text-xs font-bold text-slate-700">{type}</div>
                <div className="text-[10px] text-slate-500">{sold}/{total}</div>
            </div>
        </div>
    );
};

export default function SalesDataModal({ isOpen, onClose, data }: SalesDataModalProps) {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);

    if (!isOpen || !data || !mounted) return null;

    // --- DATA MAPPING ---
    // User specified Columns:
    // K: Total Units
    // L: Total Size
    // N: Avg Area
    // O: Price/sqm
    // P: Price Coverage %
    // S: Sold Units

    // Unit Type Mapping (Total = Sold + Unsold)
    // 1H: Y (Sold) + AI (Unsold)
    // 1-2H: Z + AJ
    // 2H: AA + AK
    // ... incrementing both

    const getNum = (key: string) => {
        const val = data[key];
        if (typeof val === 'number') return val;
        if (typeof val === 'string') return parseFloat(val.replace(/,/g, '.')) || 0;
        return 0;
    };

    const getStr = (key: string) => data[key] || '-';

    const address = getStr('E');
    const city = getStr('A');
    const lat = data.lat;

    // Stats
    const totalUnits = getNum('K');
    const totalsize = getNum('L');
    const soldUnits = getNum('S');
    const unsoldUnits = Math.max(0, totalUnits - soldUnits);

    const avgArea = getNum('N');
    const avgPriceSqm = getNum('O');
    const priceCoverage = getNum('P');

    // Unit Types
    // Keys defined by pattern: Sold start Y (col 24 index?), Unsold start AI (col 34 index?)
    // Actually passing keys as "Y", "Z", etc. from the sheet parser.
    const unitConfigs = [
        { label: '1H', soldKey: 'Y', unsoldKey: 'AI' },
        { label: '1-2H', soldKey: 'Z', unsoldKey: 'AJ' },
        { label: '2H', soldKey: 'AA', unsoldKey: 'AK' },
        { label: '2-3H', soldKey: 'AB', unsoldKey: 'AL' },
        { label: '3H', soldKey: 'AC', unsoldKey: 'AM' },
        { label: '3-4H', soldKey: 'AD', unsoldKey: 'AN' },
        { label: '4H', soldKey: 'AE', unsoldKey: 'AO' },
        { label: '4-5H', soldKey: 'AF', unsoldKey: 'AP' },
        { label: '5H+', soldKey: 'AG', unsoldKey: 'AQ' },
    ];

    const modalContent = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto flex flex-col animate-in fade-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-5 border-b border-slate-100 flex justify-between items-start bg-slate-50/50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{address}</h2>
                        <p className="text-slate-500 font-medium">{city} | {getStr('D')}</p>
                        <div className="flex flex-wrap gap-4 mt-2 text-xs text-slate-600">
                            <span className="font-semibold" title="Rakennuttaja">🏗️ {getStr('F')}</span>
                            <span title="Valmistumisvuosi">📅 {getStr('G')}</span>
                            <span title="Tontin hallintamuoto">📜 {getStr('I') === 'O' ? 'Oma tontti' : getStr('I') === 'V' ? 'Vuokratontti' : getStr('I')}</span>
                            <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded">Keskiarvo: {avgArea.toFixed(1)} m²</span>
                            <span className="bg-green-50 text-green-700 px-2 py-1 rounded">Hinnan peitto: {priceCoverage}%</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2 text-xl font-bold">&times;</button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-8">

                    {/* Top Row: Price & Pie Charts */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-center">

                        {/* Price Card */}
                        <div className="bg-gradient-to-br from-blue-50 to-white p-6 rounded-xl border border-blue-100 flex flex-col items-center justify-center text-center shadow-sm h-full">
                            <span className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-2">Keskineliöhinta</span>
                            <span className="text-3xl font-extrabold text-slate-900 tracking-tight">
                                {Math.round(avgPriceSqm).toLocaleString()} <span className="text-lg text-slate-500 font-normal">€/m²</span>
                            </span>
                            <div className="mt-4 pt-4 border-t border-blue-100 w-full flex justify-between text-xs text-slate-600">
                                <span>Koko: <b>{totalsize.toLocaleString()} m²</b></span>
                                <span>Asuntoja: <b>{totalUnits}</b></span>
                            </div>
                        </div>

                        {/* Pie Charts */}
                        <div className="col-span-1 md:col-span-2 flex justify-around items-center bg-slate-50 rounded-xl p-4 border border-slate-100 h-full">
                            {/* Sold Units Pie */}
                            <PieChart
                                value={soldUnits}
                                total={totalUnits}
                                label="Myydyt asunnot (kpl)"
                                color="bg-blue-600"
                            />
                            {/* Unsold Units Pie */}
                            <PieChart
                                value={unsoldUnits}
                                total={totalUnits}
                                label="Vapaat asunnot (kpl)"
                                color="bg-orange-400"
                            />
                        </div>
                    </div>

                    {/* Unit Breakdown */}
                    <div>
                        <div className="flex items-center justify-between mb-4 border-b pb-2">
                            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">Huoneistojakauma</h3>
                            <div className="flex gap-4 text-[10px] font-medium">
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500"></span> Myyty</span>
                                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-300"></span> Vapaa</span>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-4 justify-start overflow-x-auto pb-2">
                            {unitConfigs.map(conf => {
                                const sold = getNum(conf.soldKey);
                                const unsold = getNum(conf.unsoldKey);
                                return <UnitBar key={conf.label} type={conf.label} sold={sold} unsold={unsold} />;
                            })}
                        </div>
                    </div>

                    {/* Raw Data Toggle */}
                    <details className="group pt-4 border-t">
                        <summary className="cursor-pointer text-xs text-slate-400 hover:text-blue-600 list-none flex items-center gap-2">
                            <span className="group-open:rotate-90 transition-transform">▶</span> Debug: Raw Data
                        </summary>
                        <div className="mt-2 p-2 bg-slate-100 rounded text-[10px] font-mono overflow-auto max-h-40">
                            <pre>{JSON.stringify(data, null, 2)}</pre>
                        </div>
                    </details>

                </div>
            </div>
        </div>
    );

    return createPortal(modalContent, document.body);
}
