"use client";

import React, { useState } from 'react';
import { SthProject, UNIT_TYPES, gradeProject, formatMonthsInv, formatYm, fmtEur } from '@/lib/sthAnalysis';

// Popup card for one STH new-build project. Follows the Vision A "structured
// card" language of PlotPopupCard: tinted header band + chip, 3-tile stat row,
// ledger rows, accordions.

const GRADE_THEME: Record<string, { chipBg: string; chipText: string; headBg: string; headBorder: string }> = {
    fast: { chipBg: '#d3ecd9', chipText: '#166534', headBg: '#f0f9f2', headBorder: '#dfefe3' },
    ok: { chipBg: '#e3eec7', chipText: '#3f6212', headBg: '#f6faec', headBorder: '#e9f2d3' },
    slow: { chipBg: '#fdeccd', chipText: '#92400e', headBg: '#fdf6ec', headBorder: '#f6e8d4' },
    stuck: { chipBg: '#fbdcdc', chipText: '#991b1b', headBg: '#fdf1f1', headBorder: '#f6e0e0' },
    frozen: { chipBg: '#f3d1d1', chipText: '#7f1d1d', headBg: '#faeaea', headBorder: '#f0dada' },
    soldout: { chipBg: '#e5e7eb', chipText: '#4b5563', headBg: '#f4f5f6', headBorder: '#e7e9eb' },
    new: { chipBg: '#e7dcf7', chipText: '#6b3aa8', headBg: '#f7f2fd', headBorder: '#ebe1f7' },
};

const TENURE_LABELS: Record<string, string> = {
    'O': 'Oma tontti',
    'V': 'Vuokratontti',
    'V-LUN': 'Vuokra + lunastusoptio',
    'O&V-LUN': 'Oma & vuokra (lun.)',
};

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{children}</div>;
}

export default function SthProjectCard({ project }: { project: SthProject }) {
    const [mixOpen, setMixOpen] = useState(false);
    const p = project;
    const grade = gradeProject(p);
    const theme = GRADE_THEME[grade.id] || GRADE_THEME.soldout;

    const soldPct = p.units > 0 ? (100 * p.sold) / p.units : 0;
    const chipText = p.forSale <= 0
        ? 'Loppuunmyyty'
        : p.monthsInventory == null
            ? (grade.id === 'new' ? 'Uusi kohde' : 'Ei kauppoja 12 kk')
            : `${grade.label} · ${formatMonthsInv(p.monthsInventory)} kk varasto`;

    const mixRows = UNIT_TYPES
        .map((t, i) => ({ type: t, sold: p.soldByType[i], unsold: p.unsoldByType[i] }))
        .filter(r => r.sold + r.unsold > 0);

    const ledger: { label: string; value: React.ReactNode }[] = [
        { label: p.completed ? 'Valmistunut' : 'Valmistuu', value: formatYm(p.completionYm) },
        { label: 'Tyyppi', value: `${p.buildingType} · ka ${p.avgSize ? p.avgSize.toFixed(0) : '–'} m²` },
        {
            label: 'Tontti',
            value: `${TENURE_LABELS[p.plotTenure] || p.plotTenure || '–'}${p.landCost ? ` · ${fmtEur(p.landCost)} €/m²` : ''}`,
        },
        ...(p.financing === 'H' ? [{ label: 'Rahoitus', value: <span className="text-purple-700 font-semibold">Hitas / säännelty</span> }] : []),
        ...(p.rentedOut ? [{ label: 'Vuokrattu', value: `${p.rentedOut} asuntoa` }] : []),
    ];

    return (
        <div className="w-[300px] text-slate-900 font-sans" onWheel={e => e.stopPropagation()} onTouchMove={e => e.stopPropagation()}>
            {/* Header band */}
            <div className="px-3.5 pt-3 pb-2.5" style={{ background: theme.headBg, borderBottom: `1px solid ${theme.headBorder}` }}>
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                    <span
                        className="text-[9.5px] font-bold uppercase tracking-[0.05em] px-2 py-[2.5px] rounded-full whitespace-nowrap"
                        style={{ background: theme.chipBg, color: theme.chipText }}
                    >
                        {chipText}
                    </span>
                    {/* Tenure up front: leasehold €/m² excludes the land */}
                    <span
                        className={`text-[9.5px] font-bold uppercase tracking-[0.05em] px-2 py-[2.5px] rounded-full whitespace-nowrap ${p.tenure === 'oma'
                            ? 'bg-slate-700 text-white'
                            : 'bg-amber-100 text-amber-800 border border-dashed border-amber-400'}`}
                        title={p.tenure === 'oma' ? 'Oma tontti — hinta sisältää tontin' : 'Hinta ei sisällä tonttia'}
                    >
                        {p.tenure === 'oma' ? 'Oma tontti' : p.plotTenure === 'V-LUN' ? 'Vuokra + lun.' : 'Vuokratontti'}
                    </span>
                    {p.priceCut && (
                        <span className="text-[9.5px] font-bold px-1.5 py-[2.5px] rounded-full bg-red-100 text-red-700 whitespace-nowrap" title={p.priceChanges}>
                            ↓ hintoja alennettu
                        </span>
                    )}
                </div>
                <div className="text-[14px] font-bold leading-snug pr-4">{p.name}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">
                    {p.address} · {p.district ? p.district.charAt(0) + p.district.slice(1).toLowerCase() : p.city}
                </div>
                <div className="text-[11px] text-slate-600 font-medium mt-0.5">{p.builder || 'Rakentaja ei tiedossa'}</div>
            </div>

            <div className="px-3.5 py-3 space-y-3 bg-white">
                {/* Stat tiles */}
                <div className="grid grid-cols-3 gap-1.5">
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                        <div className="text-[13px] font-bold">{fmtEur(p.eurM2)}</div>
                        <MicroLabel>€ / m²</MicroLabel>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                        <div className="text-[13px] font-bold">{p.sold.toFixed(0)}<span className="text-slate-400 font-semibold">/{p.units.toFixed(0)}</span></div>
                        <MicroLabel>Myyty</MicroLabel>
                    </div>
                    <div className="bg-slate-50 rounded-lg px-2 py-1.5 text-center">
                        <div className="text-[13px] font-bold">{p.sold12.toFixed(0)} <span className="text-[10px] text-slate-400 font-semibold">kpl</span></div>
                        <MicroLabel>Myynti 12 kk</MicroLabel>
                    </div>
                </div>

                {/* Sales progress */}
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <MicroLabel>Myyntiaste {Math.round(soldPct)} %</MicroLabel>
                        {p.deltaSold != null && (
                            <span className={`text-[10px] font-bold ${p.deltaSold > 0 ? 'text-green-700' : 'text-slate-400'}`}>
                                {p.deltaSold >= 0 ? '+' : ''}{p.deltaSold} kpl / {p.deltaMonths} kk
                            </span>
                        )}
                    </div>
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${Math.min(100, soldPct)}%`, background: grade.color }} />
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500 mt-0.5">
                        <span>{p.forSale.toFixed(0)} myynnissä</span>
                        <span>6 kk: {p.sold6.toFixed(0)} kpl</span>
                    </div>
                </div>

                {/* Price cut detail */}
                {p.priceCut && (
                    <div className="text-[11px] bg-red-50 border border-red-100 text-red-800 rounded-lg px-2.5 py-1.5">
                        {p.priceChanges}
                    </div>
                )}

                {/* Ledger */}
                <div className="space-y-1">
                    {ledger.map((row, i) => (
                        <div key={i} className="flex items-baseline justify-between gap-2 text-[11.5px]">
                            <span className="text-slate-400 font-medium whitespace-nowrap">{row.label}</span>
                            <span className="font-semibold text-right">{row.value}</span>
                        </div>
                    ))}
                </div>

                {/* Unit mix accordion */}
                {mixRows.length > 0 && (
                    <div className="border-t border-slate-100 pt-2">
                        <button onClick={() => setMixOpen(!mixOpen)} className="w-full flex items-center justify-between text-left">
                            <MicroLabel>Huoneistojakauma</MicroLabel>
                            <svg className={`w-3 h-3 text-slate-400 transition-transform ${mixOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                            </svg>
                        </button>
                        {mixOpen && (
                            <div className="mt-2 space-y-1.5">
                                {mixRows.map(r => {
                                    const total = r.sold + r.unsold;
                                    return (
                                        <div key={r.type} className="flex items-center gap-2 text-[10.5px]">
                                            <span className="w-8 font-bold text-slate-600">{r.type}</span>
                                            <div className="flex-1 h-[9px] bg-slate-100 rounded-full overflow-hidden flex">
                                                <div style={{ width: `${(100 * r.sold) / total}%` }} className="bg-blue-500 h-full" />
                                                <div style={{ width: `${(100 * r.unsold) / total}%` }} className="bg-orange-300 h-full" />
                                            </div>
                                            <span className="w-14 text-right text-slate-500 tabular-nums">
                                                {r.sold.toFixed(0)}<span className="text-slate-300"> / </span>{r.unsold.toFixed(0)}
                                            </span>
                                        </div>
                                    );
                                })}
                                <div className="flex gap-3 pt-0.5 text-[9.5px] text-slate-400">
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500" /> Myyty</span>
                                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-300" /> Vapaana</span>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Notes */}
                {p.notes && (
                    <div className="text-[10px] text-slate-400 border-t border-slate-100 pt-1.5 leading-relaxed">{p.notes}</div>
                )}
            </div>
        </div>
    );
}
