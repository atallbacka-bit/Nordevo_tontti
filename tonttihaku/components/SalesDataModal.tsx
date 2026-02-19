"use client";

import React from 'react';

interface SalesDataModalProps {
    isOpen: boolean;
    onClose: () => void;
    data: any;
}

// Helper to draw a simple pie chart using CSS conic-gradient
const PieChart = ({ value, total, color = "bg-blue-600", label, rotate = 0 }: { value: number, total: number, color?: string, label?: string, rotate?: number }) => {
    const percentage = total > 0 ? (value / total) * 100 : 0;

    return (
        <div className="flex flex-col items-center">
            <div className="relative w-24 h-24 rounded-full bg-slate-200" style={{
                background: `conic-gradient(var(--tw-gradient-from) ${percentage}%, #e2e8f0 0)`
            }}>
                {/* Inner white circle for donut effect (optional, let's stick to pie for now or make it a donut) */}
                <div className="absolute inset-0 rounded-full flex items-center justify-center font-bold text-sm text-slate-700">
                    {Math.round(percentage)}%
                </div>
                {/* Apply the color class via style variable or class usage hack */}
                <div className={`absolute inset-0 rounded-full opacity-0 ${color}`} />
                {/* Since tailwind classes in style attributes don't work for colors directly in conic-gradient without config, 
                    we'll use direct hex or style injection. Let's use inline style for simplicity. */}
            </div>
            {/* Override the above hacky implementation with a better CSS approach */}
            <div
                className="relative w-20 h-20 rounded-full flex items-center justify-center shadow-inner"
                style={{
                    background: `conic-gradient(${color === 'bg-blue-600' ? '#2563eb' : '#dc2626'} ${percentage}%, #e2e8f0 0)`
                }}
            >
                <div className="w-14 h-14 bg-white rounded-full flex items-center justify-center text-xs font-bold text-gray-700 shadow-sm">
                    {/* {Math.round(percentage)}% */}
                    {value}/{total}
                </div>
            </div>
            {label && <span className="mt-2 text-xs font-medium text-slate-600 text-center">{label}</span>}
        </div>
    );
};

// Mini Pie for unit types
const MiniPie = ({ sold, total, label }: { sold: number, total: number, label: string }) => {
    if (!total) return null;
    const percentage = (sold / total) * 100;
    return (
        <div className="flex flex-col items-center p-2 bg-slate-50 rounded-lg border border-slate-100">
            <span className="text-xs font-bold text-slate-700 mb-1">{label}</span>
            <div
                className="relative w-10 h-10 rounded-full mb-1"
                style={{
                    background: `conic-gradient(#2563eb ${percentage}%, #e2e8f0 0)`
                }}
            />
            <span className="text-[10px] text-slate-500">{sold} / {total}</span>
        </div>
    );
};

export default function SalesDataModal({ isOpen, onClose, data }: SalesDataModalProps) {
    if (!isOpen || !data) return null;

    // Helper to verify if column exists and get value safely
    const getVal = (key: string) => data[key] || 0;
    const getStr = (key: string) => data[key] || '-';

    // Parse main stats
    const soldArea = parseFloat(getVal('MYYTY YHTEENSÄ') || 0); // Note: Column name might need adjustment based on exact Excel heade
    // Based on user prompt: "MYYTY PINTA-ALA" or similar. Let's look at the example data structure in prompt.
    // "MYYTY PINTA-ALA" isn't explicitly there, but "MYYTY" under "YHTEENSÄ"? 
    // The prompt headers are a bit messy: KAUPUNKI ... MYYTY MYYNNISSÄ MYYNTI- ASTE ... YHTEENSÄ YHTEENSÄ YHTEENSÄ
    // It seems there are grouped headers. `xlsx` JSON parsing usually handles unique keys.
    // I will assume standard unique keys or that I'll need to inspect the row data.
    // For now, I'll try to match the prompt's likely keys.

    // Attempting to match based on the prompt's "MYYTY" and "YHTEENSÄ" columns often created by Excel export
    // If headers are duplicate in Excel, `xlsx` appends _1, _2. 
    // I'll assume for this implementation that the caller (SalesAnalysisLayer) cleans/maps the data or we try flexible access.

    // Let's use the keys provided in the user's prompt example row if possible, 
    // but better: I will render the raw data keys if I can't find specific ones, OR providing a fallback.

    // Fallback logic for demo purposes based on standard expectations:
    const totalArea = parseFloat(getVal('ASM2'));
    // "MYYTY" is likely the sold area? Or "MYYTY" (units)?
    // The prompt shows: MYYTY, MYYNNISSÄ, MYYNTIASTE... then YHTEENSÄ...
    // Let's calculate from what we have.
    const unitsTotal = parseFloat(getVal('ASUNTOJA'));
    const unitsSold = parseFloat(getVal('MYYTY')); // This might be units sold
    const unitsUnsold = parseFloat(getVal('MYYNNISSÄ'));

    // If explicit sold area isn't there, we might need to rely on what's available.
    // Let's map "MYYTY YHTEENSÄ" if it exists, otherwise just show what we find.

    const avgPrice = getStr('KESKI-HINTA') !== '-' ? getStr('KESKI-HINTA') : data['ASM2'] ? data['ASM2'] : '-'; // Example fallback

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto flex flex-col" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="p-6 border-b border-slate-100 flex justify-between items-start">
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{getStr('OSOITE')}</h2>
                        <p className="text-slate-500 font-medium">{getStr('KOHDE')} | {getStr('KAUPUNKI')}</p>
                        <div className="flex gap-4 mt-2 text-sm text-slate-600">
                            <span>🏗️ {getStr('RAKENTAJA')}</span>
                            <span>📅 Valmis: {getStr('VALMIS')}</span>
                            <span>📜 {getStr('TONTTI')}</span>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-2">✕</button>
                </div>

                {/* Content */}
                <div className="p-6 space-y-8">

                    {/* Key Stats Row */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                        {/* Price Info */}
                        <div className="bg-blue-50/50 p-6 rounded-xl border border-blue-100 flex flex-col items-center justify-center text-center">
                            <span className="text-sm font-semibold text-blue-600 uppercase tracking-wider mb-1">Keski-hinta</span>
                            <span className="text-3xl font-bold text-slate-900">{typeof avgPrice === 'number' ? Math.round(avgPrice).toLocaleString() : avgPrice} €/m²</span>
                            {data['HINTA'] && <span className="text-sm text-slate-500 mt-2">Hinta yhteensä: {typeof data['HINTA'] === 'number' ? data['HINTA'].toLocaleString() : data['HINTA']} €</span>}
                        </div>

                        {/* Charts */}
                        <div className="flex justify-around items-center gap-4">
                            {/* Units Pie */}
                            <PieChart
                                value={unitsSold || 0}
                                total={unitsTotal || 1}
                                label="Asunnot (kpl)"
                                color="bg-blue-600"
                            />
                            {/* Area Pie - fallback to units if area data missing to avoid broken UI */}
                            <PieChart
                                // Try to find sold area in data, if not use units as placeholder or hidden
                                value={data['MYYTY PINTA-ALA'] || data['MYYTY_2'] || 0} // Guessing key names based on common Excel duplicates
                                total={totalArea || 1}
                                label="Pinta-ala (m²)"
                                color="bg-emerald-500"
                            />
                        </div>
                    </div>

                    {/* Unit Breakdown */}
                    <div>
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider mb-4 border-b pb-2">Huoneistojakauma</h3>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
                            {['1H', '1-2H', '2H', '2-3H', '3H', '3-4H', '4H', '4-5H', '5H &+'].map(type => {
                                // Try to construct keys. In Excel import, duplicate headers like "MYYTY" often get suffixed.
                                // We'll need intelligent key matching in the parent or strict column ordering.
                                // For now, let's assume the data object passed here contains clean keys like "1H_MYYTY" or similar 
                                // IF the parser handles it.
                                // Since I can't guarantee parser logic yet, I'll display what I can.
                                // Let's try direct access if the user provided flat headers like "1H" for total and "1H_1" for sold?
                                // Actually, typical Excel row: "1H" (Total) ... "1H" (Sold).
                                // `xlsx` usually converts to `1H`, `1H_1`.
                                const total = data[type];
                                const sold = data[`${type}_MYYTY`] || data[`${type}_1`] || 0; // heuristic
                                if (!total) return null;
                                return <MiniPie key={type} label={type} total={total} sold={sold} />;
                            })}
                        </div>
                    </div>

                    {/* Debug / Full Data Table (Foldable) */}
                    <details className="group">
                        <summary className="cursor-pointer text-xs text-slate-400 font-medium hover:text-blue-600 transition-colors list-none flex items-center gap-2">
                            <span className="group-open:rotate-90 transition-transform">▶</span> Näytä kaikki tiedot (Debug)
                        </summary>
                        <div className="mt-4 overflow-x-auto bg-slate-50 p-4 rounded-lg border border-slate-100">
                            <table className="w-full text-xs text-left">
                                <thead>
                                    <tr className="border-b border-slate-200">
                                        <th className="py-1 px-2 font-medium text-slate-600">Avain</th>
                                        <th className="py-1 px-2 font-medium text-slate-600">Arvo</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Object.entries(data).map(([k, v]) => (
                                        <tr key={k} className="border-b border-slate-100 hover:bg-white">
                                            <td className="py-1 px-2 text-slate-500 font-mono">{k}</td>
                                            <td className="py-1 px-2 text-slate-800 break-words max-w-xs">{String(v)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </details>
                </div>
            </div>
        </div>
    );
}
