"use client";

import React, { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/i18n';
import type { HkiOwnership, HkiOwner, HkiPlan, HkiPlanUnit, OwnershipSummary } from '@/lib/helsinkiOwners';
import { planReportUrl, planPhasesUrl, type PlanDocuments, type PlanDocument } from '@/lib/helsinkiPlanDocs';

// Popup for a parcel clicked on the Kiinteistöt layer: kiinteistötunnus, the
// owners / lessees Helsingin karttapalvelu publishes for it, and the
// asemakaava(s) covering it with their documents (kaavakartta + määräykset,
// kaavaselostus). Follows the PlotPopupCard token system (tinted header band
// + chip, 9px micro labels, one accent, sources demoted to the footer).

const SUMMARY_THEME: Record<OwnershipSummary, { label: string; chipBg: string; chipText: string; headBg: string; headBorder: string }> = {
    'city': { label: 'Kaupungin omistama', chipBg: '#d3ecd9', chipText: '#1b6b3a', headBg: '#f0f9f2', headBorder: '#dfefe3' },
    'city-leased': { label: 'Kaupungin vuokratontti', chipBg: '#fdebd0', chipText: '#9a5b0b', headBg: '#fff8ee', headBorder: '#f5e6cf' },
    'state': { label: 'Valtion omistama', chipBg: '#e7dcf7', chipText: '#6b3aa8', headBg: '#f7f2fd', headBorder: '#ebe1f7' },
    'organisation': { label: 'Yhtiö tai yhteisö', chipBg: '#d7e3fa', chipText: '#1e4bb8', headBg: '#eff4fd', headBorder: '#e3eaf6' },
    'private': { label: 'Yksityisomistus', chipBg: '#e5e7eb', chipText: '#4b5563', headBg: '#f4f5f6', headBorder: '#e7e9eb' },
    'mixed': { label: 'Useita omistajia', chipBg: '#e5e7eb', chipText: '#4b5563', headBg: '#f4f5f6', headBorder: '#e7e9eb' },
    'unknown': { label: 'Ei omistajatietoja', chipBg: '#e5e7eb', chipText: '#4b5563', headBg: '#f4f5f6', headBorder: '#e7e9eb' },
};
const NEUTRAL = SUMMARY_THEME.unknown;

const fmtDate = (iso?: string) => {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? iso : d.toLocaleDateString('fi-FI');
};
const fmtNum = (n: number) => Math.round(n).toLocaleString('fi-FI');
const fmtArea = (m2?: number) => (m2 == null ? '' : `${fmtNum(m2)} m²`);

function MicroLabel({ children }: { children: React.ReactNode }) {
    return <div className="text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{children}</div>;
}

function OwnerRow({ owner, leaseWord }: { owner: HkiOwner; leaseWord?: string }) {
    const t = useT();
    if (owner.masked) {
        return (
            <div className="py-1.5 text-[11px] italic text-slate-500 leading-snug">
                {t('Yksityishenkilö – tietoja ei näytetä (Tietosuojalaki 1050/2018)')}
            </div>
        );
    }
    const isLease = !!owner.ownerType && /vuokra/i.test(owner.ownerType);
    const typeLabel = !owner.ownerType
        ? leaseWord || null
        : isLease ? (leaseWord || t('Vuokraus')) : /omistus/i.test(owner.ownerType) ? t('Omistus') : owner.ownerType;
    const chip = isLease || leaseWord
        ? { background: '#fdebd0', color: '#9a5b0b' }
        : { background: '#e2e8f0', color: '#334155' };
    const meta = [
        owner.businessId ? `${t('Y-tunnus')} ${owner.businessId}` : null,
        owner.share ? `${t('Osuus')} ${owner.share}` : null,
        owner.acquired ? `${t('Saanto')} ${fmtDate(owner.acquired)}` : null,
        owner.registered ? `${t('Lainhuuto')} ${fmtDate(owner.registered)}` : null,
    ].filter(Boolean) as string[];

    return (
        <div className="py-1.5">
            <div className="flex items-start justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-slate-800 leading-snug">{owner.name}</div>
                {typeLabel && (
                    <span className="flex-none mt-px text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded" style={chip}>
                        {typeLabel}
                    </span>
                )}
            </div>
            {meta.length > 0 && (
                <div className="mt-0.5 text-[10.5px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0">
                    {meta.map((m, i) => <span key={i}>{m}</span>)}
                </div>
            )}
            {owner.address && (
                <div className="text-[10.5px] text-slate-400 mt-0.5 leading-snug">
                    {owner.address}{owner.homeTown ? ` · ${owner.homeTown}` : ''}
                </div>
            )}
        </div>
    );
}

/**
 * The city's Kaavadokumentit page is ASP.NET WebForms: downloads are
 * __doPostBack links with no URL of their own. Submitting the same form from
 * here (new tab) makes ptp.hel.fi stream the PDF straight to the browser —
 * nothing passes through this app. Synchronous on click so popup blockers
 * treat it as user-initiated.
 */
function submitPlanDocument(docs: PlanDocuments, doc: PlanDocument) {
    const form = document.createElement('form');
    form.method = 'post';
    form.action = docs.action;
    form.target = '_blank';
    form.style.display = 'none';
    const add = (name: string, value: string) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
    };
    for (const [k, v] of Object.entries(docs.fields)) {
        if (k !== '__EVENTTARGET' && k !== '__EVENTARGUMENT') add(k, v);
    }
    add('__EVENTTARGET', doc.target);
    add('__EVENTARGUMENT', '');
    document.body.appendChild(form);
    form.submit();
    setTimeout(() => form.remove(), 1000);
}

function DocButton({ label, doc, loading, onClick }: { label: string; doc?: PlanDocument; loading: boolean; onClick: () => void }) {
    if (!loading && !doc) return null;
    return (
        <button
            type="button"
            disabled={loading || !doc}
            onClick={onClick}
            title={doc ? `${doc.filename}${doc.size ? ` (${doc.size})` : ''}` : undefined}
            className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50 disabled:cursor-wait"
        >
            <svg className="w-3 h-3 flex-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" />
            </svg>
            <span>{label}</span>
            {doc?.size && <span className="font-normal text-slate-400">{doc.size}</span>}
        </button>
    );
}

function PlanRow({ plan }: { plan: HkiPlan }) {
    const t = useT();
    const [docs, setDocs] = useState<
        { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: PlanDocuments }
    >({ status: 'loading' });

    useEffect(() => {
        let cancelled = false;
        setDocs({ status: 'loading' });
        fetch(`/api/plan-documents?tunnus=${encodeURIComponent(plan.tunnus)}`)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((data: PlanDocuments) => { if (!cancelled) setDocs({ status: 'ok', data }); })
            .catch(() => { if (!cancelled) setDocs({ status: 'error' }); });
        return () => { cancelled = true; };
    }, [plan.tunnus]);

    const data = docs.status === 'ok' ? docs.data : null;
    const loading = docs.status === 'loading';
    // the coloured map is the same document, easier to read
    const kartta = data?.documents.find(d => d.kind === 'kartta-vari') || data?.documents.find(d => d.kind === 'kartta');
    const selostus = data?.documents.find(d => d.kind === 'selostus');
    const inForce = !!plan.status && /voimassa/i.test(plan.status);
    const meta = [
        plan.sanctioned ? `${t('Vahvistettu')} ${fmtDate(plan.sanctioned)}` : null,
        plan.effective ? `${t('Voimaan')} ${fmtDate(plan.effective)}` : null,
        plan.name && plan.name !== plan.tunnus ? plan.name : null,
    ].filter(Boolean) as string[];

    return (
        <div className="py-1.5">
            <div className="flex items-start justify-between gap-2">
                <div className="text-[12.5px] font-semibold text-slate-800 leading-snug">
                    {plan.tunnus}
                    {plan.type && <span className="font-normal text-slate-600"> · {plan.type}</span>}
                </div>
                {plan.status && (
                    <span
                        className="flex-none mt-px text-[9px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded"
                        style={inForce ? { background: '#d3ecd9', color: '#1b6b3a' } : { background: '#e2e8f0', color: '#334155' }}
                    >
                        {inForce ? t('Voimassa') : plan.status}
                    </span>
                )}
            </div>
            {meta.length > 0 && (
                <div className="mt-0.5 text-[10.5px] text-slate-500 flex flex-wrap gap-x-2 gap-y-0">
                    {meta.map((m, i) => <span key={i}>{m}</span>)}
                </div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
                <DocButton
                    label={t('Kaavakartta ja -määräykset (PDF)')}
                    doc={kartta}
                    loading={loading}
                    onClick={() => data && kartta && submitPlanDocument(data, kartta)}
                />
                <DocButton
                    label={t('Kaavaselostus (PDF)')}
                    doc={selostus}
                    loading={loading}
                    onClick={() => data && selostus && submitPlanDocument(data, selostus)}
                />
            </div>
            <div className="mt-1 text-[10px] text-slate-400 flex flex-wrap gap-x-2 gap-y-0">
                <a href={planReportUrl(plan.tunnus)} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700 underline decoration-slate-300">
                    {t('Kaavadokumentit')} ↗
                </a>
                <a href={planPhasesUrl(plan.tunnus)} target="_blank" rel="noopener noreferrer" className="hover:text-blue-700 underline decoration-slate-300">
                    {t('Käsittelyvaiheet')} ↗
                </a>
                {docs.status === 'error' && <span className="italic">{t('Dokumenttilistaa ei saatu haettua')}</span>}
                {data && !kartta && !selostus && <span className="italic">{t('Ei ladattavia dokumentteja')}</span>}
            </div>
        </div>
    );
}

function planUnitLine(u: HkiPlanUnit): string {
    return [
        u.order,
        u.buildingRightM2 != null ? `${fmtNum(u.buildingRightM2)} k-m²` : null,
        u.areaM2 != null ? fmtArea(u.areaM2) : null,
        u.type && !/tonttirekisteritontti/i.test(u.type) ? u.type : null,
    ].filter(Boolean).join(' · ');
}

function Skeleton() {
    return (
        <div className="px-4 py-3 space-y-2 animate-pulse">
            <div className="h-3 w-40 rounded bg-slate-200" />
            <div className="h-2.5 w-52 rounded bg-slate-100" />
            <div className="h-2.5 w-28 rounded bg-slate-100" />
        </div>
    );
}

export default function ParcelOwnerPopup({ tunnus, onResize }: { tunnus: string; onResize?: () => void }) {
    const t = useT();
    const rootRef = useRef<HTMLDivElement>(null);
    const [state, setState] = useState<
        { status: 'loading' } | { status: 'error' } | { status: 'ok'; data: HkiOwnership }
    >({ status: 'loading' });
    const [attempt, setAttempt] = useState(0);
    const [copied, setCopied] = useState(false);

    // Content arrives asynchronously and the popup grows upwards from its
    // anchor; Leaflet only auto-pans on open, so tell it to re-lay-out.
    useEffect(() => {
        if (!onResize || !rootRef.current || typeof ResizeObserver === 'undefined') return;
        const ro = new ResizeObserver(() => onResize());
        ro.observe(rootRef.current);
        return () => ro.disconnect();
    }, [onResize]);

    useEffect(() => {
        let cancelled = false;
        setState({ status: 'loading' });
        setCopied(false);
        fetch(`/api/property-owners?tunnus=${encodeURIComponent(tunnus)}`)
            .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
            .then((data: HkiOwnership) => { if (!cancelled) setState({ status: 'ok', data }); })
            .catch(() => { if (!cancelled) setState({ status: 'error' }); });
        return () => { cancelled = true; };
    }, [tunnus, attempt]);

    const data = state.status === 'ok' ? state.data : null;
    const theme = data && data.supported ? SUMMARY_THEME[data.summary] || NEUTRAL : NEUTRAL;
    const estate = data?.estate;
    const karttapalveluUrl = `https://kartta.hel.fi/?setlanguage=fi&autosearch=${encodeURIComponent(tunnus)}`;

    const copyTunnus = () => {
        navigator.clipboard?.writeText(tunnus).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        }).catch(() => { });
    };

    const leaseUnits = data?.controlUnits.filter(u => u.owners.length > 0 || u.name || u.areaM2) ?? [];
    const plans = data?.plans ?? [];
    const planUnits = (data?.planUnits ?? []).filter(u => u.order || u.buildingRightM2 != null || u.areaM2 != null);

    return (
        <div
            ref={rootRef}
            className="w-[300px] text-slate-800 max-h-[420px] overflow-y-auto"
            onWheel={(e) => e.stopPropagation()}
            onTouchMove={(e) => e.stopPropagation()}
        >
            {/* Header band */}
            <div className="px-4 pt-3 pb-2.5 pr-9" style={{ background: theme.headBg, borderBottom: `1px solid ${theme.headBorder}` }}>
                <MicroLabel>{t('Kiinteistö')}</MicroLabel>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                    <button
                        type="button"
                        onClick={copyTunnus}
                        title={t('klikkaa kopioidaksesi')}
                        className="text-[15px] font-bold tracking-tight text-slate-900 hover:text-blue-700 text-left whitespace-nowrap"
                    >
                        {tunnus}
                        {copied && <span className="ml-2 text-[10px] font-semibold text-emerald-600">{t('Kopioitu')}</span>}
                    </button>
                    {data && data.supported && (
                        <span
                            className="flex-none whitespace-nowrap text-[9.5px] font-bold uppercase tracking-[0.06em] px-1.5 py-0.5 rounded"
                            style={{ background: theme.chipBg, color: theme.chipText }}
                        >
                            {t(theme.label)}
                        </span>
                    )}
                </div>
                {estate && (estate.address || estate.areaM2 != null) && (
                    <div className="mt-1 text-[11px] text-slate-600 leading-snug">
                        {estate.address && <div>{estate.address}{estate.postal ? `, ${estate.postal}` : ''}</div>}
                        <div className="text-slate-500">
                            {[
                                estate.areaM2 != null ? `${t('Rekisteripinta-ala')} ${fmtArea(estate.areaM2)}` : null,
                                estate.registered ? `${t('Rekisteröity')} ${fmtDate(estate.registered)}` : null,
                            ].filter(Boolean).join(' · ')}
                        </div>
                    </div>
                )}
            </div>

            {/* Body */}
            {state.status === 'loading' && <Skeleton />}

            {state.status === 'error' && (
                <div className="px-4 py-3 text-[11.5px] text-slate-600">
                    {t('Omistajatietojen haku epäonnistui')}.{' '}
                    <button type="button" onClick={() => setAttempt(a => a + 1)} className="font-semibold text-blue-700 hover:underline">
                        {t('Yritä uudelleen')}
                    </button>
                </div>
            )}

            {data && !data.supported && (
                <div className="px-4 py-3 text-[11.5px] text-slate-600 leading-snug">
                    {t('Omistajatiedot ovat saatavilla vain Helsingin kiinteistöille')}.
                </div>
            )}

            {data && data.supported && (
                <div className="px-4 pt-2.5 pb-1">
                    <MicroLabel>{t('Omistajat / Vuokralaiset')}</MicroLabel>
                    {data.owners.length === 0 ? (
                        <div className="py-1.5 text-[11px] text-slate-500 italic">{t('Ei omistajatietoja rekisterissä')}</div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {data.owners.map((o, i) => <OwnerRow key={i} owner={o} />)}
                        </div>
                    )}

                    {leaseUnits.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-100">
                            <MicroLabel>{t('Hallintayksiköt (vuokra-alueet)')}</MicroLabel>
                            {leaseUnits.map(u => (
                                <div key={u.key} className="mt-1">
                                    <div className="text-[11px] text-slate-600">
                                        <span className="font-semibold text-slate-700">{u.kind}</span>
                                        {u.name ? ` · ${u.name}` : ''}
                                        {u.areaM2 != null ? ` · ${fmtArea(u.areaM2)}` : ''}
                                        {u.registered ? ` · ${fmtDate(u.registered)}` : ''}
                                    </div>
                                    {u.owners.length > 0 && (
                                        <div className="divide-y divide-slate-100 pl-2 border-l-2 border-slate-100">
                                            {u.owners.map((o, i) => <OwnerRow key={i} owner={o} leaseWord={t('Vuokralainen')} />)}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Asemakaava + documents */}
                    <div className="mt-2 pt-2 border-t border-slate-100">
                        <MicroLabel>{t('Asemakaava')}</MicroLabel>
                        {planUnits.length > 0 && (
                            <div className="mt-0.5 text-[10.5px] text-slate-500 leading-snug">
                                {planUnits.map((u, i) => (
                                    <div key={i}>
                                        <span className="text-slate-400">{t('Kaavayksikkö')}</span> {planUnitLine(u)}
                                    </div>
                                ))}
                            </div>
                        )}
                        {plans.length === 0 ? (
                            <div className="py-1.5 text-[11px] text-slate-500 italic">{t('Ei asemakaavaa rekisterissä')}</div>
                        ) : (
                            <div className="divide-y divide-slate-100">
                                {plans.map(p => <PlanRow key={p.key} plan={p} />)}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Footer */}
            <div className="px-4 pt-1.5 pb-3">
                {(!data || data.supported) && (
                    <a
                        href={karttapalveluUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block w-full text-center rounded-md py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
                        style={{ background: '#1e4bb8' }}
                    >
                        {t('Avaa karttapalvelussa →')}
                    </a>
                )}
                {(!data || data.supported) && (
                    <div className="mt-2 text-[9px] text-slate-400 leading-snug">
                        {t('Lähde: Helsingin karttapalvelu, kiinteistörekisteri')}
                        {plans.length > 0 ? ` · ${t('kaavadokumentit ptp.hel.fi')}` : ''}
                        {data?.fetchedAt ? ` · ${fmtDate(data.fetchedAt)}` : ''}
                    </div>
                )}
            </div>
        </div>
    );
}
