"use client";

import React, { useState } from 'react';
import { PlotData } from '@/types';
import { ZONING_TYPES, getZoningColor } from '@/lib/constants';
import {
    parseZonings,
    parseNotes,
    parseContacts,
    getContactPersons,
    formatDate,
    formatShortDate,
    formatCompactPrice
} from '@/lib/plotUtils';

// Status theme: chip + tinted header band. Single accent (blue) elsewhere.
const STATUS_THEME: Record<string, { chipBg: string; chipText: string; headBg: string; headBorder: string }> = {
    'Vapaa': { chipBg: '#d7e3fa', chipText: '#1e4bb8', headBg: '#eff4fd', headBorder: '#e3eaf6' },
    'Kilpailussa': { chipBg: '#fbdcdc', chipText: '#a02525', headBg: '#fdf1f1', headBorder: '#f6e0e0' },
    'Tarjottu': { chipBg: '#d3ecd9', chipText: '#1b6b3a', headBg: '#f0f9f2', headBorder: '#dfefe3' },
    'Pidossa': { chipBg: '#e7dcf7', chipText: '#6b3aa8', headBg: '#f7f2fd', headBorder: '#ebe1f7' },
    'Mennyt': { chipBg: '#e5e7eb', chipText: '#4b5563', headBg: '#f4f5f6', headBorder: '#e7e9eb' },
};

interface PlotPopupCardProps {
    plot: PlotData;
    onEdit: (plot: PlotData) => void;
    onMarkSold: (plot: PlotData) => void;
    onMarkOffered: (plot: PlotData) => void;
    onEditContacts: (plot: PlotData) => void;
    onLogContact: (plot: PlotData) => void;
    onAddNote: (plotId: string, plotName: string) => void;
    onShowHistory: (plot: PlotData) => void;
}

function Chevron({ open }: { open: boolean }) {
    return (
        <svg
            className={`w-3 h-3 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
    );
}

function MicroLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">
            {children}
        </div>
    );
}

export default function PlotPopupCard({
    plot,
    onEdit,
    onMarkSold,
    onMarkOffered,
    onEditContacts,
    onLogContact,
    onAddNote,
    onShowHistory
}: PlotPopupCardProps) {
    const [contactsOpen, setContactsOpen] = useState(true);
    const [eventsOpen, setEventsOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const isSold = plot.status === 'Mennyt';
    const theme = STATUS_THEME[plot.status] || STATUS_THEME['Vapaa'];

    const zonings = parseZonings(plot);
    const notes = parseNotes(plot);
    const contacts = parseContacts(plot);
    const persons = getContactPersons(plot);

    const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || plot.buildingRight || 0;
    const priceToUse = isSold
        ? plot.finalPrice
        : (plot.status === 'Tarjottu' && plot.offerPrice) ? plot.offerPrice : plot.priceEst;
    const unitPrice = isSold
        ? (plot.pricePerRight || ((plot.finalPrice && totalBR) ? Math.round(plot.finalPrice / totalBR) : null))
        : ((priceToUse && totalBR) ? Math.round(priceToUse / totalBR) : null);

    const priceLabel = isSold ? 'Kauppahinta' : (plot.status === 'Tarjottu' && plot.offerPrice) ? 'Tarjous' : 'Hinta-arvio';

    const events = [
        ...notes.map(n => ({ id: n.id, type: 'note' as const, date: n.timestamp, who: n.author, person: '', text: n.text })),
        ...contacts.map(c => ({ id: c.id, type: 'contact' as const, date: c.timestamp || c.date, who: c.agent, person: c.person, text: c.desc }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    const copyShareLink = async () => {
        const url = `${window.location.origin}${window.location.pathname}?plot=${plot.id}`;
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            setTimeout(() => { setCopied(false); setMenuOpen(false); }, 1200);
        } catch (err) {
            console.error('Failed to copy link', err);
        }
    };

    const chipText = plot.status === 'Kilpailussa' && plot.deadline
        ? `Kilpailussa · DL ${formatShortDate(plot.deadline)}`
        : plot.status;

    const ledgerRows: { label: string; value: string }[] = isSold
        ? [
            { label: 'Kauppapäivä', value: plot.soldDate ? formatDate(plot.soldDate) : '–' },
            { label: 'Ostaja', value: plot.buyer || '–' },
            { label: 'Myyjä', value: plot.seller || '–' },
            ...(plot.area ? [{ label: 'Pinta-ala', value: `${plot.area.toLocaleString('fi-FI')} m²` }] : []),
            ...(plot.kiinteistotunnus ? [{ label: 'Kiinteistötunnus', value: plot.kiinteistotunnus }] : []),
        ]
        : [
            ...(plot.area ? [{ label: 'Pinta-ala', value: `${plot.area.toLocaleString('fi-FI')} m²` }] : []),
            ...(plot.material ? [{ label: 'Materiaali', value: plot.material }] : []),
            { label: 'Myyjä', value: plot.seller || '–' },
            ...(plot.kiinteistotunnus ? [{ label: 'Kiinteistötunnus', value: plot.kiinteistotunnus }] : []),
        ];

    return (
        <div
            className="w-[300px] text-slate-900 font-sans"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            {/* Header band */}
            <div
                className="px-3.5 pt-3 pb-2.5"
                style={{ background: theme.headBg, borderBottom: `1px solid ${theme.headBorder}` }}
            >
                <div className="flex items-center gap-2 mb-1.5">
                    <span
                        className="text-[9.5px] font-bold uppercase tracking-[0.05em] px-2 py-[2.5px] rounded-full whitespace-nowrap"
                        style={{ background: theme.chipBg, color: theme.chipText }}
                    >
                        {chipText}
                    </span>
                    <span className="ml-auto mr-4 text-[10.5px] text-slate-400">{plot.kunta || ''}</span>
                </div>
                <h3 className="text-[15px] font-bold leading-tight text-slate-900 m-0">{plot.name || plot.address}</h3>
                {plot.address && plot.name && (
                    <div className="text-[11.5px] text-slate-500 mt-0.5">{plot.address}</div>
                )}
            </div>

            {/* Key figure row */}
            <div className="grid grid-cols-3 divide-x divide-slate-100 border-b border-slate-100 tabular-nums">
                <div className="py-2.5 px-1 text-center">
                    <div className="text-[15.5px] font-bold leading-tight">{totalBR ? totalBR.toLocaleString('fi-FI') : '–'}</div>
                    <div className="text-[8.5px] font-bold uppercase tracking-[0.07em] text-slate-400 mt-0.5">k-m²</div>
                </div>
                <div className="py-2.5 px-1 text-center">
                    <div className="text-[15.5px] font-bold leading-tight">{formatCompactPrice(priceToUse) || '–'}</div>
                    <div className="text-[8.5px] font-bold uppercase tracking-[0.07em] text-slate-400 mt-0.5">{priceLabel}</div>
                </div>
                <div className="py-2.5 px-1 text-center">
                    <div className="text-[15.5px] font-bold leading-tight">
                        {unitPrice ? unitPrice.toLocaleString('fi-FI') : '–'}
                        {unitPrice ? <span className="text-[10px] font-semibold text-slate-400 ml-0.5">€</span> : null}
                    </div>
                    <div className="text-[8.5px] font-bold uppercase tracking-[0.07em] text-slate-400 mt-0.5">€ / k-m²</div>
                </div>
            </div>

            {/* Body */}
            <div className="px-3.5 py-2.5 space-y-2.5">
                {/* Zoning breakdown */}
                <div>
                    <MicroLabel>Kaavatyypit</MicroLabel>
                    <div className="mt-1">
                        {zonings.map((z, idx) => (
                            <div key={idx} className="flex items-center gap-1.5 py-[1.5px] text-[12px] text-slate-600">
                                <span className="w-2 h-2 rounded-full flex-none" style={{ background: getZoningColor(z.type) }} />
                                <span>{z.type} · {ZONING_TYPES.find(zt => zt.code === z.type)?.label || z.type}</span>
                                <span className="ml-auto font-semibold text-slate-900 tabular-nums">{z.buildingRight?.toLocaleString('fi-FI')} k-m²</span>
                            </div>
                        ))}
                        {zonings.length > 1 && (
                            <div className="flex text-[11.5px] font-bold border-t border-slate-100 mt-1 pt-1 tabular-nums">
                                <span>Yhteensä</span>
                                <span className="ml-auto">{totalBR.toLocaleString('fi-FI')} k-m²</span>
                            </div>
                        )}
                    </div>
                </div>

                {/* Details ledger */}
                <div className="space-y-[3px]">
                    {ledgerRows.map((row) => (
                        <div key={row.label} className="flex text-[11.5px]">
                            <span className="text-slate-500">{row.label}</span>
                            <span className="ml-auto font-medium text-slate-800 text-right">{row.value}</span>
                        </div>
                    ))}
                </div>

                {/* Description */}
                {plot.desc && (
                    <div className="text-[11px] leading-snug text-slate-600 italic border-l-2 border-slate-200 pl-2">
                        {plot.desc}
                    </div>
                )}

                {!isSold && (
                    <>
                        {/* Contacts accordion */}
                        <div className="border-t border-slate-100 pt-2">
                            <div
                                className="flex items-center gap-1.5 cursor-pointer select-none"
                                onClick={() => setContactsOpen(!contactsOpen)}
                            >
                                <span className="text-[12px] font-semibold text-slate-700">Yhteystiedot</span>
                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-px">{persons.length}</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onEditContacts(plot); }}
                                    className="ml-auto text-[10px] text-blue-600 hover:underline"
                                >
                                    Muokkaa
                                </button>
                                <Chevron open={contactsOpen} />
                            </div>
                            {contactsOpen && (
                                persons.length > 0 ? (
                                    <div className="mt-1.5 space-y-1.5">
                                        {persons.map((person, idx) => (
                                            <div key={idx} className="text-[12px] leading-snug">
                                                <span className="font-semibold text-slate-900">{person.name}</span>
                                                {person.role && <span className="text-slate-500 text-[11px]"> · {person.role}</span>}
                                                {(person.phone || person.email) && (
                                                    <div className="text-[11px] text-blue-600">
                                                        {[person.phone, person.email].filter(Boolean).join(' · ')}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="mt-1 text-[11px] text-slate-400 italic">Ei yhteystietoja.</div>
                                )
                            )}
                        </div>

                        {/* Events accordion */}
                        <div className="border-t border-slate-100 pt-2">
                            <div
                                className="flex items-center gap-1.5 cursor-pointer select-none"
                                onClick={() => setEventsOpen(!eventsOpen)}
                            >
                                <span className="text-[12px] font-semibold text-slate-700">Tapahtumat</span>
                                <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 rounded-full px-1.5 py-px">{events.length}</span>
                                <button
                                    onClick={(e) => { e.stopPropagation(); onAddNote(plot.id, plot.name); }}
                                    className="ml-auto text-[10px] text-blue-600 hover:underline"
                                >
                                    + Muistiinpano
                                </button>
                                <Chevron open={eventsOpen} />
                            </div>
                            {eventsOpen && (
                                events.length > 0 ? (
                                    <>
                                        <div className="mt-1.5 max-h-[120px] overflow-y-auto pr-1">
                                            {events.map((item, idx) => (
                                                <div
                                                    key={`${item.type}-${item.id || idx}`}
                                                    className="text-[11px] leading-snug py-1.5 border-b border-slate-100 last:border-0"
                                                >
                                                    <div className="flex items-baseline">
                                                        <span className="font-semibold text-slate-800 tabular-nums">{formatDate(item.date)}</span>
                                                        <span className="text-slate-400 ml-1.5">{item.type === 'contact' ? 'Kontaktointi' : 'Muistiinpano'}</span>
                                                        <span className="ml-auto text-slate-400">{item.who}</span>
                                                    </div>
                                                    {item.type === 'contact' && item.person && (
                                                        <div className="text-slate-500">{item.person}</div>
                                                    )}
                                                    <p className="text-slate-600 mt-0.5 m-0">{item.text}</p>
                                                </div>
                                            ))}
                                        </div>
                                        <button
                                            onClick={() => onShowHistory(plot)}
                                            className="mt-1 text-[10px] text-blue-600 hover:underline"
                                        >
                                            Näytä kaikki ({events.length})
                                        </button>
                                    </>
                                ) : (
                                    <div className="mt-1 text-[11px] text-slate-400 italic">Ei tapahtumia.</div>
                                )
                            )}
                        </div>
                    </>
                )}
            </div>

            {/* Actions */}
            <div className="relative flex gap-1.5 px-3.5 pt-2.5 pb-1.5 border-t border-slate-100">
                {!isSold && (
                    persons.length > 0 ? (
                        <button
                            onClick={() => onLogContact(plot)}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold rounded-lg py-[7px] px-2"
                        >
                            Uusi kontaktointi
                        </button>
                    ) : (
                        <button
                            onClick={() => onEditContacts(plot)}
                            className="flex-1 bg-blue-600 hover:bg-blue-700 text-white text-[12px] font-semibold rounded-lg py-[7px] px-2"
                        >
                            Lisää yhteyshenkilö
                        </button>
                    )
                )}
                <button
                    onClick={() => onEdit(plot)}
                    className={`${isSold ? 'flex-1' : ''} bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 text-[12px] font-semibold rounded-lg py-[7px] px-3`}
                >
                    Muokkaa
                </button>
                <button
                    onClick={() => setMenuOpen(!menuOpen)}
                    className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-500 text-[13px] font-bold rounded-lg py-[7px] px-2.5 leading-none"
                    aria-label="Lisää toimintoja"
                >
                    ⋯
                </button>

                {menuOpen && (
                    <div className="absolute right-3.5 bottom-[calc(100%+4px)] w-44 bg-white border border-slate-200 rounded-lg shadow-lg py-1 z-20">
                        <button
                            onClick={copyShareLink}
                            className="w-full text-left px-3 py-1.5 text-[11.5px] text-slate-700 hover:bg-slate-50"
                        >
                            {copied ? 'Linkki kopioitu ✓' : 'Jaa linkki'}
                        </button>
                        {!isSold && (
                            <>
                                <button
                                    onClick={() => { setMenuOpen(false); onMarkOffered(plot); }}
                                    className="w-full text-left px-3 py-1.5 text-[11.5px] text-slate-700 hover:bg-slate-50"
                                >
                                    Merkitse tarjotuksi
                                </button>
                                <button
                                    onClick={() => { setMenuOpen(false); onMarkSold(plot); }}
                                    className="w-full text-left px-3 py-1.5 text-[11.5px] text-slate-700 hover:bg-slate-50"
                                >
                                    Merkitse myydyksi
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>

            {/* Meta footer */}
            <div className="px-3.5 pb-2 pt-0.5 text-center text-[9px] text-slate-400 leading-tight">
                {plot.createdAt && <>Lisätty {formatDate(plot.createdAt)} · {plot.createdBy || '–'}</>}
                {plot.createdAt && plot.updatedAt && <span className="mx-1">—</span>}
                {plot.updatedAt && <>Päivitetty {formatDate(plot.updatedAt)} · {plot.updatedBy || '–'}</>}
            </div>
        </div>
    );
}
