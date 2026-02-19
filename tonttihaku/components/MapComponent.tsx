"use client";

// Sanitize HTML to prevent XSS from external WMS responses
function sanitizeHtml(html: string): string {
    if (typeof window === 'undefined') return '';
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script').forEach(el => el.remove());
    doc.querySelectorAll('*').forEach(el => {
        for (const attr of Array.from(el.attributes)) {
            if (attr.name.startsWith('on')) el.removeAttribute(attr.name);
        }
        if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('javascript:')) {
            el.removeAttribute('href');
        }
    });
    return doc.body.innerHTML;
}

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, WMSTileLayer, LayersControl, useMap, Marker, Popup, Pane, GeoJSON } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import FilterPanel from './FilterPanel';
import AddPlotModal from './AddPlotModal';
import SalesAnalysisLayer from './SalesAnalysisLayer';
import { ZONING_TYPES, getZoningColor, getPlotColor, STATUS_OPTIONS } from '@/lib/constants';
import { PlotFilters, SalesFilters } from '@/types';
import MarkSoldModal from './MarkSoldModal';
import NoteModal from './NoteModal';
import MarkOfferedModal from './MarkOfferedModal';
import EditContactInfoModal from './EditContactInfoModal';
import LogContactModal from './LogContactModal';
import HistoryModal from './HistoryModal';

// Parse zonings from JSON string or legacy format
function parseZonings(plot: any): { type: string, buildingRight: number }[] {
    if (plot.zonings) {
        try {
            const parsed = typeof plot.zonings === 'string' ? JSON.parse(plot.zonings) : plot.zonings;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [{ type: plot.zoning?.split(' ')[0] || 'AK', buildingRight: plot.buildingRight || 0 }];
}

// Parse notes from JSON string
function parseNotes(plot: any): { id: string, text: string, author: string, timestamp: string }[] {
    if (plot.notes) {
        try {
            const parsed = typeof plot.notes === 'string' ? JSON.parse(plot.notes) : plot.notes;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [];
}

// Parse contacts from JSON string
function parseContacts(plot: any): any[] {
    if (plot.contacts) {
        try {
            const parsed = typeof plot.contacts === 'string' ? JSON.parse(plot.contacts) : plot.contacts;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [];
}

// Get marker size based on building rights (30-50px range - smaller variance)
function getMarkerSize(buildingRight: number): number {
    const minSize = 30;
    const maxSize = 50;
    const minBR = 0;
    const maxBR = 10000;
    const clamped = Math.min(Math.max(buildingRight, minBR), maxBR);
    return minSize + ((clamped - minBR) / (maxBR - minBR)) * (maxSize - minSize);
}


// Get zoning label for marker
function getZoningLabel(zonings: { type: string, buildingRight: number }[]): string {
    if (zonings.length === 1) return zonings[0].type;
    return zonings.map(z => z.type).join('/');
}

// Format date for display
function formatDate(dateStr: string): string {
    if (!dateStr) return '';
    try {
        return new Date(dateStr).toLocaleDateString('fi-FI');
    } catch {
        return dateStr;
    }
}

// Sales popup content with expandable details
function SalesPopupContent({
    sale,
    parseZonings,
    formatDate,
    getZoningColor
}: {
    sale: any;
    parseZonings: (plot: any) => { type: string, buildingRight: number }[];
    formatDate: (dateStr: string) => string;
    getZoningColor: (code: string) => string;
}) {
    const [showDetails, setShowDetails] = useState(false);
    const zonings = parseZonings(sale);
    const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || sale.buildingRight || 0;

    return (
        <div className="text-sm min-w-[220px]">
            {/* Essential info - always visible */}
            <h3 className="font-bold text-lg mb-1">{sale.name || sale.address}</h3>

            {sale.updatedBy && (
                <p className="text-gray-500 text-xs mb-2">Kirjaaja: {sale.updatedBy}</p>
            )}

            <div className="space-y-1 mb-2">
                <p className="font-semibold text-green-700">Hinta: {sale.finalPrice?.toLocaleString()} €</p>

                {/* Zoning info */}
                <div className="bg-gray-50 p-2 rounded">
                    {zonings.map((z, idx) => (
                        <div key={idx} className="flex justify-between items-center text-sm">
                            <span style={{ color: getZoningColor(z.type) }} className="font-medium">
                                {z.type} - {ZONING_TYPES.find(zt => zt.code === z.type)?.label || z.type}
                            </span>
                            <span className="font-semibold">{z.buildingRight?.toLocaleString()} k-m²</span>
                        </div>
                    ))}
                    {zonings.length > 1 && (
                        <div className="border-t mt-1 pt-1 flex justify-between font-bold text-xs">
                            <span>Yhteensä</span>
                            <span>{totalBR.toLocaleString()} k-m²</span>
                        </div>
                    )}
                </div>

                {sale.desc && <p className="text-gray-600 italic">{sale.desc}</p>}
            </div>

            {/* Expandable details */}
            <button
                onClick={() => setShowDetails(!showDetails)}
                className="w-full text-xs text-blue-600 hover:text-blue-800 py-1 border-t mt-2"
            >
                {showDetails ? '▲ Piilota lisätiedot' : '▼ Lisää tarkentavia tietoja'}
            </button>

            {showDetails && (
                <div className="mt-2 pt-2 border-t space-y-1 text-gray-700">
                    {sale.address && <p>Osoite: {sale.address}</p>}
                    <p>Ostaja: {sale.buyer || '-'}</p>
                    {sale.pricePerRight && (
                        <p className="font-semibold">€/k-m²: {sale.pricePerRight?.toLocaleString()} €</p>
                    )}
                    {sale.area && <p>Pinta-ala: {sale.area} m²</p>}
                    {sale.seller && <p>Myyjä: {sale.seller}</p>}
                    <p className="text-gray-500 text-xs">Kauppapäivä: {formatDate(sale.soldDate)}</p>
                    {sale.createdAt && (
                        <p className="text-gray-400 text-xs">Lisätty: {formatDate(sale.createdAt)} ({sale.createdBy || '-'})</p>
                    )}
                </div>
            )}
        </div>
    );
}

// Fix Leaflet icon issue in Next.js
const iconUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png';
const iconRetinaUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png';
const shadowUrl = 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png';

if (typeof window !== 'undefined') {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
}

// Helper to update WMS params
function WMSUpdater({ cqlFilter, opacity, layerRef }: { cqlFilter: string, opacity: number, layerRef: React.RefObject<L.TileLayer.WMS> }) {
    const map = useMap();
    useEffect(() => {
        if (layerRef.current) {
            layerRef.current.setParams({ cql_filter: cqlFilter } as any);
            layerRef.current.setOpacity(opacity);
        }
    }, [cqlFilter, opacity, layerRef]);
    return null;
}



function PropertyBoundariesLayer({ visible }: { visible: boolean }) {
    const map = useMap();
    const [data, setData] = useState<any>(null);
    const [layerKey, setLayerKey] = useState<number>(0);

    useEffect(() => {
        if (!visible) {
            setData(null);
            return;
        }

        const fetchData = async () => {
            if (map.getZoom() < 13) {
                setData(null);
                return;
            }

            const bounds = map.getBounds();
            const bbox = `${bounds.getWest()},${bounds.getSouth()},${bounds.getEast()},${bounds.getNorth()}`;
            const url = `/api/property-boundaries?bbox=${encodeURIComponent(bbox)}`;

            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error(`Failed to fetch property boundaries`);
                const geojson = await res.json();
                setData(geojson);
                setLayerKey(Date.now());
            } catch (err) {
                console.error('PropertyBoundaries: Error fetching:', err);
            }
        };

        fetchData();

        const onMoveEnd = () => {
            if (visible) fetchData();
        };

        map.on('moveend', onMoveEnd);
        return () => { map.off('moveend', onMoveEnd); };
    }, [visible, map]);

    if (!visible || !data || !data.features || data.features.length === 0) return null;

    return (
        <GeoJSON
            key={layerKey}
            data={data}
            style={{ color: '#ff0000', weight: 2, fillOpacity: 0.02, opacity: 1 }}
            onEachFeature={(feature, layer) => {
                const props = feature.properties;
                if (props && props.kiinteistotunnuksenEsitysmuoto) {
                    const propertyId = props.kiinteistotunnuksenEsitysmuoto;
                    const autoSearchUrl = `https://kartta.hel.fi/?setlanguage=fi&autosearch=${encodeURIComponent(propertyId)}`;
                    const popupContent = `
                        <div style="min-width: 160px;">
                            <div style="margin-bottom: 8px;">
                                <b>Kiinteistö:</b><br/>
                                <span style="font-size: 14px; font-weight: 500;">${propertyId}</span>
                            </div>
                            <a href="${autoSearchUrl}" target="_blank" 
                               style="display: block; width: 100%; padding: 8px; background: #0066cc; color: white; 
                                      text-align: center; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: 500; box-sizing: border-box;">
                                Avaa karttapalvelussa →
                            </a>
                        </div>
                    `;
                    layer.bindPopup(popupContent);
                }
            }}
        />
    );
}

export default function MapComponent() {
    const [cqlFilter, setCqlFilter] = useState('laskvar_ak < 0 AND laskvar_ap < 0');
    const [hasSearched, setHasSearched] = useState(false);
    const [wmsOpacity, setWmsOpacity] = useState(1.0);
    const [korkeusOpacity, setKorkeusOpacity] = useState(0.7);

    const [showMaapera, setShowMaapera] = useState(false);
    const [showMelu, setShowMelu] = useState(false);
    const [showKorkeus, setShowKorkeus] = useState(false);
    const [showSalesAnalysis, setShowSalesAnalysis] = useState(false);

    const wmsLayerRef = useRef<L.TileLayer.WMS>(null);
    const korkeusLayerRef = useRef<L.TileLayer.WMS>(null);

    // Plots State
    const [showPlots, setShowPlots] = useState(false);
    const [addPlotMode, setAddPlotMode] = useState(false);
    const [plotsData, setPlotsData] = useState<any[]>([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [newPlotLocation, setNewPlotLocation] = useState<{ lat: number, lng: number } | null>(null);

    // Edit mode states
    const [editModalMode, setEditModalMode] = useState<'add' | 'edit'>('add');
    const [editingPlot, setEditingPlot] = useState<any>(null);

    // Note modal state
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [notePlotId, setNotePlotId] = useState<string | null>(null);
    const [notePlotName, setNotePlotName] = useState<string>('');

    // Mark Sold Modal State
    const [isMarkSoldModalOpen, setIsMarkSoldModalOpen] = useState(false);
    const [plotToMarkSold, setPlotToMarkSold] = useState<any>(null);

    // Mark Offered Modal State
    const [isMarkOfferedModalOpen, setIsMarkOfferedModalOpen] = useState(false);
    const [plotToMarkOffered, setPlotToMarkOffered] = useState<any>(null);

    // Contact Modals State
    const [isEditContactModalOpen, setIsEditContactModalOpen] = useState(false);
    const [contactPlot, setContactPlot] = useState<any>(null);

    const [isLogContactModalOpen, setIsLogContactModalOpen] = useState(false);
    const [logContactPlot, setLogContactPlot] = useState<any>(null);
    // Flow state: Return to log modal after adding contact
    const [returnToLogContact, setReturnToLogContact] = useState(false);
    const [logContactPreselectId, setLogContactPreselectId] = useState<string | undefined>(undefined);

    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyPlot, setHistoryPlot] = useState<any>(null);

    // Plot filters state
    const [plotFilters, setPlotFilters] = useState<PlotFilters>({
        zoningTypes: ZONING_TYPES.map(z => z.code),
        buildingRightMin: '',
        buildingRightMax: '',
        status: 'Vapaa,Kilpailussa',
        kunnat: []
    });

    // Sales filters state
    const [salesFilters, setSalesFilters] = useState<SalesFilters>({
        zoningTypes: [],
        buildingRightMin: '',
        buildingRightMax: ''
    });

    const [showKiinteistot, setShowKiinteistot] = useState(false);
    const [showAsemakaavaInfo, setShowAsemakaavaInfo] = useState(false);
    const [popupInfo, setPopupInfo] = useState<{ lat: number, lng: number, content: string } | null>(null);

    // Sales State
    const [showSales, setShowSales] = useState(false);
    const [showApartments, setShowApartments] = useState(false);
    const [editMode, setEditMode] = useState(false);
    // salesData is derived from plotsData in render/useMemo
    const [apartmentData, setApartmentData] = useState<any[]>([]);

    // Fetch plots data (contains both active and sold plots)
    useEffect(() => {
        if (showPlots || showSales) {
            fetch('/api/plots')
                .then(res => res.json())
                .then(data => setPlotsData(Array.isArray(data) ? data : []))
                .catch(err => console.error(err));
        }
    }, [showPlots, showSales]);

    // Derive Sales Data from Plots Data (Status = Mennyt)
    const salesData = useMemo(() => {
        return plotsData.filter(p => p.status === 'Mennyt');
    }, [plotsData]);

    // Derive unique kunnat from all plots for the filter dropdown
    const availableKunnat = useMemo(() => {
        const kunnatSet = new Set<string>();
        plotsData.forEach(p => {
            if (p.kunta) kunnatSet.add(p.kunta);
        });
        return Array.from(kunnatSet).sort();
    }, [plotsData]);

    // Mock Data for Apartments
    const MOCK_APARTMENTS = [
        { id: 'mock1', lat: 60.26, lng: 24.85, company: 'As Oy Helsingin Esimerkki', address: 'Esimerkkitie 1', price: 350000, size: 75, pricePerSqm: 4667 },
        { id: 'mock2', lat: 60.24, lng: 24.80, company: 'As Oy Espoon Malli', address: 'Mallikuja 2', price: 280000, size: 55, pricePerSqm: 5091 },
        { id: 'mock3', lat: 60.27, lng: 24.90, company: 'As Oy Vantaan Testi', address: 'Testikatu 3', price: 210000, size: 45, pricePerSqm: 4667 },
    ];

    useEffect(() => {
        if (showApartments) {
            fetch('/api/apartments')
                .then(res => {
                    if (!res.ok) throw new Error('Failed to fetch');
                    return res.json();
                })
                .then(data => {
                    if (Array.isArray(data) && data.length > 0) {
                        setApartmentData(data);
                    } else {
                        setApartmentData(MOCK_APARTMENTS);
                    }
                })
                .catch(() => setApartmentData(MOCK_APARTMENTS));
        }
    }, [showApartments]);

    // Calculate visible plots based on filters
    const visiblePlots = useMemo(() => {
        // Debug logs
        console.log('DEBUG: plotsData length:', plotsData.length);
        console.log('DEBUG: plotFilters:', plotFilters);

        return plotsData.filter((plot) => {
            // Apply status filter
            // plotFilters.status contains comma-separated values like "Vapaa,Kilpailussa"
            if (plotFilters.status) {
                const selectedStatuses = plotFilters.status.split(',');
                if (selectedStatuses.length > 0 && !selectedStatuses.includes(plot.status)) {
                    return false;
                }
            } else {
                return false;
            }

            // Apply zoning type filter
            if (plotFilters.zoningTypes.length > 0) {
                const zonings = parseZonings(plot);
                const plotZoningCodes = zonings.map(z => z.type);
                const hasMatchingZoning = plotFilters.zoningTypes.some(filterType =>
                    plotZoningCodes.includes(filterType)
                );
                if (!hasMatchingZoning) return false;
            }

            // Apply building right filter
            const zonings = parseZonings(plot);
            const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || plot.buildingRight || 0;

            if (plotFilters.buildingRightMin) {
                const min = parseInt(plotFilters.buildingRightMin);
                if (totalBR < min) return false;
            }
            if (plotFilters.buildingRightMax) {
                const max = parseInt(plotFilters.buildingRightMax);
                if (totalBR > max) return false;
            }

            // Apply kunta filter (empty array = show all, before API loads)
            if (plotFilters.kunnat && plotFilters.kunnat.length > 0) {
                const plotKunta = plot.kunta || 'Helsinki';
                if (!plotFilters.kunnat.includes(plotKunta)) return false;
            }

            return true;
        });
    }, [plotsData, plotFilters]);

    // Save plot (add or update)
    const savePlot = async (plot: any, action: 'add' | 'update') => {
        try {
            // First save/update the plot
            const res = await fetch('/api/plots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action, plot, id: plot.id })
            });
            const data = await res.json();
            if (data.success) {
                setPlotsData(data.plots);
            } else {
                alert("Virhe tallennuksessa: " + (data.error || 'Tuntematon virhe'));
            }
        } catch (err) {
            console.error(err);
            alert("Virhe tallennuksessa: " + err);
        }
    };

    // Add note to plot
    const addNote = async (plotId: string, note: { text: string, author: string }) => {
        try {
            const res = await fetch('/api/plots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'addNote', id: plotId, note })
            });
            const data = await res.json();
            if (data.success) {
                setPlotsData(data.plots);
            } else {
                alert("Virhe muistiinpanon tallennuksessa: " + (data.error || 'Tuntematon virhe'));
            }
        } catch (err) {
            console.error(err);
            alert("Virhe muistiinpanon tallennuksessa: " + err);
        }
    };


    // Open Edit Modal (Shared)
    const openEditModal = (plot: any) => {
        setEditingPlot(plot);
        setEditModalMode('edit');
        setIsAddModalOpen(true);
    };

    const openMarkAsSoldModal = (plot: any) => {
        setPlotToMarkSold(plot);
        setIsMarkSoldModalOpen(true);
    };

    const handleMarkAsSoldSave = async (salesData: any) => {
        if (!plotToMarkSold) return;

        const updatedPlot = {
            ...plotToMarkSold,
            status: 'Mennyt',
            buyer: salesData.buyer,
            finalPrice: salesData.finalPrice,
            soldDate: salesData.soldDate,
            updatedBy: salesData.updatedBy, // Save who marked it as sold
            desc: salesData.desc ? (plotToMarkSold.desc ? plotToMarkSold.desc + '\n\n' + salesData.desc : salesData.desc) : plotToMarkSold.desc
        };

        await savePlot(updatedPlot, 'update');
        setPlotToMarkSold(null);
    };

    const openMarkAsOfferedModal = (plot: any) => {
        setPlotToMarkOffered(plot);
        setIsMarkOfferedModalOpen(true);
    };

    const handleMarkAsOfferedSave = async (offerData: any) => {
        if (!plotToMarkOffered) return;

        const updatedPlot = {
            ...plotToMarkOffered,
            status: 'Tarjottu',
            offerPrice: offerData.offerPrice,
            offerDate: offerData.offerDate,
            offerDesc: offerData.desc,
            updatedBy: offerData.updatedBy,
            desc: offerData.desc ? (plotToMarkOffered.desc ? plotToMarkOffered.desc + '\n\n' + offerData.desc : offerData.desc) : plotToMarkOffered.desc
        };

        await savePlot(updatedPlot, 'update');
        setPlotToMarkOffered(null);
    };

    // Helper to get contact persons
    const getContactPersons = (plot: any) => {
        try {
            if (plot.contactPersons) {
                const parsed = typeof plot.contactPersons === 'string' ? JSON.parse(plot.contactPersons) : plot.contactPersons;
                if (Array.isArray(parsed)) return parsed;
            }
            // Fallback to legacy fields if no contactPersons array
            if (plot.contactPerson) {
                return [{
                    id: 'legacy',
                    name: plot.contactPerson,
                    phone: plot.contactPhone,
                    email: plot.contactEmail
                }];
            }
        } catch (e) {
            console.error('Error parsing contact persons:', e);
        }
        return [];
    };

    // Contact Handlers
    const openEditContactModal = (plot: any) => {
        setContactPlot(plot);
        setIsEditContactModalOpen(true);
    };

    const handleContactInfoSave = async (contactPersons: any[]) => {
        if (!contactPlot) return;

        // Optimistic update
        const primaryContact = contactPersons[0] || {};
        const updatedPlot = {
            ...contactPlot,
            contactPersons: JSON.stringify(contactPersons),
            // Maintain legacy sync for simple views
            contactPerson: primaryContact.name || '',
            contactPhone: primaryContact.phone || '',
            contactEmail: primaryContact.email || ''
        };

        await savePlot(updatedPlot, 'update');
        setContactPlot(null);
        setIsEditContactModalOpen(false);

        // If in return flow, go back to log modal
        if (returnToLogContact) {
            // Find the newest contact (assuming appended to end or check IDs)
            // Simpler: just take the last one since newly added are usually last
            const newestContact = contactPersons[contactPersons.length - 1];
            if (newestContact) {
                setLogContactPreselectId(newestContact.id);
            }
            // Re-open log modal for the SAME plot (it was closed but we have reference)
            // Wait, contactPlot is nullified above. We need to use the plot we just updated.
            // Actually updatedPlot has the id.
            setLogContactPlot(updatedPlot); // Use the updated plot data
            setIsLogContactModalOpen(true);
            setReturnToLogContact(false); // Reset flow
        }
    };

    const openLogContactModal = (plot: any) => {
        setLogContactPlot(plot);
        setIsLogContactModalOpen(true);
    };

    const handleLogContactSave = async (log: any) => {
        if (!logContactPlot) return;

        try {
            const res = await fetch('/api/plots', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'addContact',
                    id: logContactPlot.id,
                    note: {
                        date: log.date,
                        desc: log.desc,
                        agent: log.agent,
                        method: 'Muu',
                        person: log.person || logContactPlot.contactPerson || 'Ei määritelty',
                        personId: log.personId
                    }
                })
            });
            const data = await res.json();
            if (data.success) {
                setPlotsData(data.plots);
            } else {
                alert("Virhe tallennuksessa.");
            }
        } catch (err) {
            console.error(err);
            alert("Virhe tallennuksessa.");
        }
        setLogContactPlot(null);
        setIsLogContactModalOpen(false);
    };

    const openHistoryModal = (plot: any) => {
        setHistoryPlot(plot);
        setIsHistoryModalOpen(true);
    };

    const handleSearch = (filters: any) => {
        const parts = [];
        for (const key in filters) {
            if (filters[key]) {
                if (key.endsWith('_min')) {
                    parts.push(`${key.replace('_min', '')} >= ${filters[key]}`);
                } else if (key.endsWith('_max')) {
                    parts.push(`${key.replace('_max', '')} <= ${filters[key]}`);
                }
            }
        }
        const query = parts.length > 0 ? parts.join(' AND ') : 'laskvar_ak < 0 AND laskvar_ap < 0';
        setCqlFilter(query);
        setHasSearched(true);
    };

    // Click handler for GetFeatureInfo
    function MapEvents() {
        const map = useMap();

        useEffect(() => {
            const onClick = async (e: L.LeafletMouseEvent) => {
                let content = '';

                if (showAsemakaavaInfo) {
                    const url = 'https://kartta.hel.fi/ws/geoserver/avoindata/wms';
                    const params = {
                        request: 'GetFeatureInfo',
                        service: 'WMS',
                        srs: 'EPSG:4326',
                        styles: '',
                        transparent: true,
                        version: '1.1.1',
                        format: 'image/png',
                        bbox: map.getBounds().toBBoxString(),
                        height: map.getSize().y,
                        width: map.getSize().x,
                        layers: 'Ajantasa_asemakaava_maanpaallinen_varillinen',
                        query_layers: 'Ajantasa_asemakaava_maanpaallinen_varillinen',
                        info_format: 'text/html',
                        x: Math.round(e.containerPoint.x),
                        y: Math.round(e.containerPoint.y)
                    };
                    const queryString = Object.keys(params).map(key => `${key}=${encodeURIComponent(params[key as keyof typeof params] as any)}`).join('&');
                    try {
                        const res = await fetch(`${url}?${queryString}`);
                        const text = await res.text();
                        if (text && text.length > 100) content += `<b>Asemakaava:</b><br />${sanitizeHtml(text)}<br />`;
                    } catch (err) { console.error(err); }
                }

                if (content) {
                    setPopupInfo({ lat: e.latlng.lat, lng: e.latlng.lng, content: content });
                }
            };

            const onEditClick = (e: L.LeafletMouseEvent) => {
                // Sale implementation removed/changed, disabling this for now or redirecting to AddPlotModal
                // If we want to support adding SOLD plots directly, we can open AddPlotModal with status 'Mennyt'
                if (isAddModalOpen) return;
                setNewPlotLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
                setEditModalMode('add');
                // Could pre-set status to 'Mennyt' if we had a way to pass that info
                // For now, let's just reuse the plot add flow
                setIsAddModalOpen(true);
            };

            const onAddPlotClick = (e: L.LeafletMouseEvent) => {
                if (isAddModalOpen) return;
                setNewPlotLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
                setEditModalMode('add');
                setEditingPlot(null);
                setIsAddModalOpen(true);
            };

            if (editMode) {
                // 'editMode' was previously for Sales layer editing.
                // We'll map this to onAddPlotClick behavior for consistency or disable it if preferred.
                // User requirement: "the once we manually add in the tunnetut tontit section are the onces that we are actually interested"
                // So adding sales directly might be less important, but let's keep it functional as adding a plot
                map.on('click', onAddPlotClick);
            } else if (addPlotMode) {
                map.on('click', onAddPlotClick);
            } else {
                map.on('click', onClick);
            }

            return () => {
                map.off('click', onClick);
                map.off('click', onAddPlotClick);
            };
        }, [map, showKiinteistot, showAsemakaavaInfo, editMode, addPlotMode, isAddModalOpen]);

        return null;
    }

    // Update korkeus opacity
    useEffect(() => {
        if (korkeusLayerRef.current) {
            korkeusLayerRef.current.setOpacity(korkeusOpacity);
        }
    }, [korkeusOpacity]);

    const handleLayerToggle = (layer: string, visible: boolean) => {
        if (layer === 'maapera') setShowMaapera(visible);
        if (layer === 'melu') setShowMelu(visible);
        if (layer === 'korkeus') setShowKorkeus(visible);
        if (layer === 'kiinteistot') setShowKiinteistot(visible);
        if (layer === 'asemakaava_info') setShowAsemakaavaInfo(visible);
        if (layer === 'sales_analysis') setShowSalesAnalysis(visible);

        if (layer === 'sales') {
            setShowSales(visible);
            if (!visible) setEditMode(false);
        }
        if (layer === 'plots') {
            setShowPlots(visible);
            if (!visible) setAddPlotMode(false);
        }

        if (layer === 'edit_mode') {
            if (showSales) setEditMode(visible);
            else {
                if (visible) alert("Ota ensin 'Myydyt tontit' -taso käyttöön.");
                setEditMode(false);
            }
        }
        if (layer === 'add_plot_mode') {
            if (showPlots) setAddPlotMode(visible);
            else {
                if (visible) alert("Ota ensin 'Tunnetut tontit' -taso käyttöön.");
                setAddPlotMode(false);
            }
        }
        if (layer === 'apartments') setShowApartments(visible);
    };



    // Open note modal for a plot
    const openNoteModal = (plotId: string, plotName: string) => {
        setNotePlotId(plotId);
        setNotePlotName(plotName);
        setIsNoteModalOpen(true);
    };

    // Get status color
    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Vapaa': return 'text-green-600';
            case 'Kilpailussa': return 'text-orange-600';
            case 'Mennyt': return 'text-gray-500';
            default: return 'text-gray-700';
        }
    };

    return (
        <div className="flex w-full h-full">
            <FilterPanel
                onSearch={handleSearch}
                onOpacityChange={setWmsOpacity}
                onLayerToggle={handleLayerToggle}
                onKorkeusOpacityChange={setKorkeusOpacity}
                layerStates={{
                    plots: showPlots,
                    sales: showSales,
                    apartments: showApartments,
                    kiinteistot: showKiinteistot,
                    asemakaava_info: showAsemakaavaInfo,
                    korkeus: showKorkeus,
                    maapera: showMaapera,
                    melu: showMelu,
                    edit_mode: editMode,
                    add_plot_mode: addPlotMode,
                    sales_analysis: showSalesAnalysis
                }}
                onPlotFiltersChange={setPlotFilters}
                onSalesFiltersChange={setSalesFilters}
                visiblePlots={visiblePlots}
                availableKunnat={availableKunnat}
            />
            <div className="flex-grow h-full relative z-0">
                <MapContainer center={[60.25, 24.8]} zoom={10} style={{ height: '100%', width: '100%' }}>
                    <MapEvents />
                    {popupInfo && (
                        <Popup
                            position={[popupInfo.lat, popupInfo.lng]}
                            eventHandlers={{ remove: () => setPopupInfo(null) }}
                        >
                            <div
                                dangerouslySetInnerHTML={{ __html: popupInfo.content }}
                                className="max-h-60 overflow-auto"
                                onWheel={(e) => e.stopPropagation()}
                                onTouchMove={(e) => e.stopPropagation()}
                            />
                        </Popup>
                    )}

                    {/* Sales Markers */}
                    {showSales && salesData
                        .filter((sale) => {
                            if (salesFilters.zoningTypes.length > 0) {
                                // Zoning is stored as a stringified JSON in 'zonings'
                                const zonings = parseZonings(sale); // This works for plots too
                                const saleZoningCode = zonings[0]?.type || '';
                                if (saleZoningCode && !salesFilters.zoningTypes.includes(saleZoningCode)) {
                                    return false;
                                }
                            }
                            // Building right usually derived from zonings or direct field
                            const zonings = parseZonings(sale);
                            const br = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || sale.buildingRight || 0;

                            if (salesFilters.buildingRightMin) {
                                const min = parseInt(salesFilters.buildingRightMin);
                                if (br < min) return false;
                            }
                            if (salesFilters.buildingRightMax) {
                                const max = parseInt(salesFilters.buildingRightMax);
                                if (br > max) return false;
                            }
                            return true;
                        })
                        .map((sale, i) => (
                            sale.lat && sale.lng ? (
                                <Marker
                                    key={sale.id || i}
                                    position={[sale.lat, sale.lng]}
                                    eventHandlers={{
                                        click: () => {
                                            if (editMode) {
                                                // Just open regular edit modal for now
                                                openEditModal(sale);
                                            }
                                        }
                                    }}
                                >
                                    <Popup>
                                        <SalesPopupContent sale={sale} parseZonings={parseZonings} formatDate={formatDate} getZoningColor={getZoningColor} />
                                    </Popup>
                                </Marker>
                            ) : null
                        ))}

                    {/* Apartment Markers */}
                    {showApartments && apartmentData.map((apt, i) => (
                        apt.lat && apt.lng ? (
                            <Marker
                                key={apt.id || i}
                                position={[apt.lat, apt.lng]}
                                icon={L.divIcon({
                                    className: 'custom-div-icon',
                                    html: `<div style="background-color: #10b981; color: white; padding: 4px; border-radius: 4px; font-weight: bold; font-size: 12px;">${apt.pricePerSqm} €</div>`,
                                    iconSize: [60, 24],
                                    iconAnchor: [30, 12]
                                })}
                            >
                                <Popup>
                                    <div className="text-sm">
                                        <h3 className="font-bold">{apt.company}</h3>
                                        <p>{apt.address}</p>
                                        <p>Hinta: {apt.price} €</p>
                                        <p>Koko: {apt.size} m²</p>
                                        <p className="font-semibold">Neliöhinta: {apt.pricePerSqm} €/m²</p>
                                    </div>
                                </Popup>
                            </Marker>
                        ) : null
                    ))}

                    {/* Plots Markers */}
                    {showPlots && visiblePlots.map((plot, i) => {
                        if (!plot.lat || !plot.lng) return null;
                        const zonings = parseZonings(plot);
                        const notes = parseNotes(plot);
                        const contacts = parseContacts(plot);
                        const latestContact = contacts.length > 0 ? contacts[contacts.length - 1] : null;

                        const primaryColor = getZoningColor(zonings[0]?.type || 'AK');
                        const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || plot.buildingRight || 0;
                        const markerSize = getMarkerSize(totalBR);
                        const label = getZoningLabel(zonings);

                        const priceToUse = (plot.status === 'Tarjottu' && plot.offerPrice) ? plot.offerPrice : plot.priceEst;
                        const unitPrice = (priceToUse && totalBR) ? Math.round(priceToUse / totalBR) : null;

                        // Status determination
                        const isCompetition = plot.status === 'Kilpailussa';
                        const isOffered = plot.status === 'Tarjottu';
                        const isSold = plot.status === 'Mennyt';

                        // Base styles
                        let markerHtml = '';
                        let anchor: [number, number] = [(markerSize + 10) / 2, (markerSize + 10) / 2];
                        let size: [number, number] = [markerSize + 10, markerSize + 10];

                        // Style configuration based on status
                        const plotColor = getPlotColor(plot.status, zonings[0]?.type || 'AK');

                        if (isCompetition) {
                            // Competition: Red Circle with border
                            markerHtml = `<div style="
                                background-color: ${plotColor};
                                color: white;
                                width: ${markerSize}px;
                                height: ${markerSize}px;
                                border-radius: 50%;
                                border: 3px solid white;
                                box-shadow: 0 4px 6px rgba(220, 38, 38, 0.4);
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                font-weight: bold;
                                font-size: ${Math.max(10, markerSize / 3.5)}px;
                            ">
                                <div style="line-height:1;">${label}</div>
                                <div style="font-size:0.7em; opacity:0.9;">${totalBR.toLocaleString()}</div>
                            </div>`;
                        } else if (isOffered) {
                            // Offered: Green Pill with dashed border
                            markerHtml = `<div style="
                                background-color: ${plotColor};
                                color: white;
                                padding: 6px 10px;
                                border-radius: 9999px;
                                border: 2px dashed white;
                                box-shadow: 0 4px 6px rgba(22, 163, 74, 0.4);
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                font-weight: bold;
                                font-size: ${Math.max(10, markerSize / 4)}px;
                                min-width: ${markerSize + 10}px;
                                text-align: center;
                                transform: scale(1.05);
                            ">
                                <div>${label}</div>
                                <div style="font-size:0.8em; opacity:0.9;">${totalBR.toLocaleString()}</div>
                                ${unitPrice ? `<div style='font-size:0.75em; background:rgba(0,0,0,0.15); padding:0 3px; border-radius:3px; margin-top:2px;'>${unitPrice.toLocaleString()} €</div>` : ''}
                            </div>`;
                        } else if (isSold) {
                            // Sold: Gray/Transparent with Data
                            markerHtml = `<div style="
                                background-color: ${plotColor};
                                color: white;
                                padding: 4px 6px;
                                border-radius: 6px;
                                border: 1px solid rgba(255,255,255,0.8);
                                box-shadow: none;
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                font-weight: normal;
                                font-size: ${Math.max(9, markerSize / 4.5)}px;
                                min-width: ${markerSize}px;
                                text-align: center;
                                opacity: 0.9;
                            ">
                                <div>${label}</div>
                                <div style="font-size:0.8em; opacity:0.8;">${totalBR.toLocaleString()}</div>
                                ${unitPrice ? `<div style='font-size:0.75em; opacity:0.7; margin-top:1px;'>${unitPrice.toLocaleString()} €</div>` : ''}
                            </div>`;
                        } else if (plot.status === 'Pidossa') {
                            // Pidossa: Purple, rounded square (distinct shape/style)
                            markerHtml = `<div style="
                                background-color: ${plotColor};
                                color: white;
                                padding: 5px;
                                border-radius: 4px; /* Slightly sharper corners than Vapaa */
                                border: 2px solid white;
                                box-shadow: 0 2px 4px rgba(88, 28, 135, 0.3);
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                font-weight: bold;
                                font-size: ${Math.max(10, markerSize / 4)}px;
                                min-width: ${markerSize}px;
                                text-align: center;
                            ">
                                <div>${label}</div>
                                <div style="font-size:0.8em; opacity:0.95;">${totalBR.toLocaleString()}</div>
                            </div>`;
                        } else {
                            // Vapaa (Default): Zoning Color (Blues) Square with rounded corners
                            markerHtml = `<div style="
                                background-color: ${plotColor};
                                color: white;
                                padding: 4px 6px;
                                border-radius: 6px;
                                border: 2px solid white;
                                box-shadow: 0 2px 4px rgba(0,0,0,0.2);
                                display: flex;
                                flex-direction: column;
                                justify-content: center;
                                align-items: center;
                                font-weight: bold;
                                font-size: ${Math.max(10, markerSize / 4)}px;
                                min-width: ${markerSize}px;
                                text-align: center;
                            ">
                                <div>${label}</div>
                                <div style="font-size:0.8em; opacity:0.95;">${totalBR.toLocaleString()}</div>
                                ${unitPrice ? `<div style='font-size:0.75em; background:rgba(0,0,0,0.15); padding:0 3px; border-radius:3px; margin-top:2px;'>${unitPrice.toLocaleString()} €</div>` : ''}
                            </div>`;
                        }

                        return (
                            <Marker
                                key={plot.id || i}
                                position={[plot.lat, plot.lng]}
                                icon={L.divIcon({
                                    className: 'custom-plot-icon',
                                    html: markerHtml,
                                    iconSize: size,
                                    iconAnchor: anchor
                                })}
                            >
                                <Popup>


                                    <div
                                        className="text-sm min-w-[260px] max-w-[320px] relative pt-2"
                                        onWheel={(e) => e.stopPropagation()}
                                        onTouchMove={(e) => e.stopPropagation()}
                                    >
                                        {/* Created/Updated info - Moved to top right */}
                                        <div className="absolute top-0 right-0 text-[10px] text-gray-400 text-right leading-tight max-w-[120px]">
                                            {plot.createdAt && (
                                                <div className="truncate">Lisätty: {formatDate(plot.createdAt)} ({plot.createdBy || '-'})</div>
                                            )}
                                            {plot.updatedAt && (
                                                <div className="truncate">Päivitetty: {formatDate(plot.updatedAt)} ({plot.updatedBy || '-'})</div>
                                            )}
                                        </div>

                                        <h3 className="font-bold text-lg mb-1 pr-36 leading-tight">{plot.name}</h3>
                                        <div className="space-y-1">
                                            <p className="text-gray-600">{plot.address}</p>

                                            {/* Status with deadline */}
                                            <p className={`font-bold ${getStatusColor(plot.status)}`}>
                                                {plot.status}
                                                {plot.status === 'Kilpailussa' && plot.deadline && (
                                                    <span className="font-normal ml-2">
                                                        (DL: {formatDate(plot.deadline)})
                                                    </span>
                                                )}
                                            </p>

                                            {/* Zoning breakdown */}
                                            <div className="bg-gray-50 p-1.5 rounded my-1.5">
                                                <div className="text-[10px] font-semibold text-gray-500 uppercase mb-0.5">Kaavatyypit</div>
                                                {zonings.map((z, idx) => (
                                                    <div key={idx} className="flex justify-between items-center text-sm">
                                                        <span style={{ color: getZoningColor(z.type) }} className="font-medium">
                                                            {z.type} - {ZONING_TYPES.find(zt => zt.code === z.type)?.label || z.type}
                                                        </span>
                                                        <span className="font-semibold">{z.buildingRight?.toLocaleString()} k-m²</span>
                                                    </div>
                                                ))}
                                                {zonings.length > 1 && (
                                                    <div className="border-t mt-0.5 pt-0.5 flex justify-between font-bold text-sm">
                                                        <span>Yhteensä</span>
                                                        <span>{totalBR.toLocaleString()} k-m²</span>
                                                    </div>
                                                )}
                                            </div>

                                            <div className="grid grid-cols-2 gap-x-2 text-gray-700">
                                                <span>Pinta-ala:</span> <span className="font-medium">{plot.area} m²</span>
                                                <span>{plot.status === 'Tarjottu' ? 'Tarjous:' : 'Hinta-arvio:'}</span>
                                                <span className="font-medium">
                                                    {(plot.status === 'Tarjottu' && plot.offerPrice ? plot.offerPrice : plot.priceEst)?.toLocaleString()} €
                                                </span>
                                                {unitPrice && (
                                                    <>
                                                        <span>Yksikköhinta:</span>
                                                        <span className="font-medium">{unitPrice.toLocaleString()} €/k-m²</span>
                                                    </>
                                                )}
                                            </div>
                                            <p className="text-gray-800">Myyjä: <span className="font-semibold">{plot.seller || '-'}</span></p>
                                            {plot.kiinteistotunnus && <p className="text-gray-800">Kiinteistötunnus: <span className="font-semibold">{plot.kiinteistotunnus}</span></p>}

                                            {plot.desc && <p className="text-gray-600 italic border-t pt-1 mt-1 text-[10px]">{plot.desc}</p>}

                                            {/* Contact Info - Compact Version (Moved Up) */}
                                            <div className="border-t pt-1 mt-1">
                                                <div className="flex justify-between items-center mb-0.5">
                                                    <div className="text-[10px] font-semibold text-gray-500 uppercase">Yhteystiedot</div>
                                                    <button
                                                        onClick={() => openEditContactModal(plot)}
                                                        className="text-[10px] text-blue-600 hover:underline"
                                                    >
                                                        Muokkaa/lisää
                                                    </button>
                                                </div>

                                                {getContactPersons(plot).length > 0 ? (
                                                    <div className="grid grid-cols-1 gap-0.5 mb-1">
                                                        {getContactPersons(plot).map((person: any, idx: number) => (
                                                            <div key={idx} className="text-[10px] text-gray-800 bg-slate-50 px-1.5 py-0.5 rounded border border-slate-200 flex flex-wrap gap-x-2 items-center">
                                                                <span className="font-semibold">{person.name}</span>
                                                                {person.role && <span className="text-gray-500 italic text-[10px]">({person.role})</span>}
                                                                {person.phone && <span className="text-gray-600 text-[10px]">{person.phone}</span>}
                                                                {person.email && <span className="text-gray-600 text-[10px]">{person.email}</span>}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div className="mb-1 text-[10px] text-gray-400 italic">Ei yhteystietoja.</div>
                                                )}
                                            </div>

                                            {/* Unified History Container - Compact Version (Moved Down) */}
                                            {(notes.length > 0 || contacts.length > 0) && (
                                                <div className="border-t pt-1 mt-1">
                                                    <div className="flex justify-between items-center mb-0.5">
                                                        <div className="text-[10px] font-semibold text-gray-500 uppercase">
                                                            Tapahtumat ({notes.length + contacts.length})
                                                        </div>
                                                        <button
                                                            onClick={() => openHistoryModal(plot)}
                                                            className="text-[10px] text-blue-600 hover:underline"
                                                        >
                                                            Näytä kaikki
                                                        </button>
                                                    </div>
                                                    {/* Increased max-height slightly to ensure 1.5 items visible (approx 100px for detailed items) */}
                                                    <div className="max-h-[110px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                                                        {[
                                                            ...notes.map(n => ({ ...n, type: 'note', date: n.timestamp })),
                                                            ...contacts.map(c => ({ ...c, type: 'contact', date: c.timestamp || c.date }))
                                                        ]
                                                            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
                                                            .map((item, idx) => (
                                                                <div
                                                                    key={`${item.type}-${item.id || idx}`}
                                                                    className={`text-[10px] p-1.5 rounded border leading-tight ${item.type === 'contact'
                                                                        ? 'bg-green-50/50 border-green-100'
                                                                        : 'bg-yellow-50/50 border-yellow-100'
                                                                        }`}
                                                                >
                                                                    {item.type === 'contact' ? (
                                                                        <>
                                                                            {/* Header: Date | Agent (Right) */}
                                                                            <div className="flex justify-between items-start mb-0.5">
                                                                                <span className="font-bold text-green-800">
                                                                                    {formatDate(item.date)}
                                                                                </span>
                                                                                <span className="text-[10px] text-gray-400">
                                                                                    {item.agent}
                                                                                </span>
                                                                            </div>
                                                                            {/* Subheader: Contact Person */}
                                                                            <div className="text-[10px] text-gray-600 mb-1 font-medium">
                                                                                {item.person || 'Tuntematon'}
                                                                            </div>
                                                                            {/* Body: Comment */}
                                                                            <p className="text-gray-800">
                                                                                {item.desc}
                                                                            </p>
                                                                        </>
                                                                    ) : (
                                                                        <>
                                                                            <div className="flex justify-between items-center mb-0.5">
                                                                                <span className="font-semibold text-yellow-700">
                                                                                    {formatDate(item.date)}
                                                                                </span>
                                                                                <span className="text-[10px] text-gray-400">
                                                                                    {item.author}
                                                                                </span>
                                                                            </div>
                                                                            <p className="text-gray-700">
                                                                                {item.text}
                                                                            </p>
                                                                        </>
                                                                    )}
                                                                </div>
                                                            ))}
                                                    </div>
                                                </div>
                                            )}

                                            <div className="flex gap-2 mt-1">
                                                {getContactPersons(plot).length > 0 && (
                                                    <button
                                                        onClick={() => openLogContactModal(plot)}
                                                        className="flex-1 px-2 py-1 text-[10px] font-medium text-white bg-green-600 rounded hover:bg-green-700 shadow-sm"
                                                    >
                                                        Uusi kontaktointi
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => openNoteModal(plot.id, plot.name)}
                                                    className="flex-1 px-2 py-1 text-[10px] font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded hover:bg-yellow-100"
                                                >
                                                    Lisää muistiinpano
                                                </button>
                                            </div>

                                            {/* Action buttons */}
                                            <div className="border-t pt-1 mt-1 flex gap-2">
                                                <button
                                                    onClick={() => openEditModal(plot)}
                                                    className="flex-1 px-2 py-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                                                >
                                                    Muokkaa
                                                </button>
                                                {plot.status !== 'Mennyt' && (
                                                    <button
                                                        onClick={() => openMarkAsSoldModal(plot)}
                                                        className="flex-1 px-2 py-1 text-[10px] font-medium text-green-700 bg-green-50 border border-green-200 rounded hover:bg-green-100"
                                                    >
                                                        Merkitse myydyksi
                                                    </button>
                                                )}
                                                {plot.status !== 'Mennyt' && (
                                                    <button
                                                        onClick={() => openMarkAsOfferedModal(plot)}
                                                        className="flex-1 px-2 py-1 text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded hover:bg-blue-100"
                                                    >
                                                        Merkitse tarjotuksi
                                                    </button>
                                                )}
                                            </div>

                                        </div>
                                    </div>
                                </Popup>
                            </Marker>
                        );
                    })}

                    <LayersControl position="topright">
                        <LayersControl.BaseLayer checked name="OpenStreetMap">
                            <TileLayer
                                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Satelliitti">
                            <TileLayer
                                attribution='Tiles &copy; Esri'
                                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                            />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Asemakaava (Helsinki)">
                            <WMSTileLayer
                                url="https://kartta.hel.fi/ws/geoserver/avoindata/wms"
                                layers="Ajantasa_asemakaava_maanpaallinen_varillinen"
                                format="image/png"
                                transparent={true}
                            />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Asemakaava (Espoo)">
                            <WMSTileLayer
                                url="https://kartat.espoo.fi/teklaogcweb/wms.ashx"
                                layers="Ajantasa_asemakaava_vektori"
                                format="image/png"
                                transparent={true}
                                version="1.1.1"
                            />
                        </LayersControl.BaseLayer>
                        <LayersControl.BaseLayer name="Asemakaava (Vantaa)">
                            <WMSTileLayer
                                url="https://gis.vantaa.fi/geoserver/wms"
                                layers="kaava:asemakaavahakemisto,kaava:asemakaava_mv"
                                format="image/png"
                                transparent={true}
                            />
                        </LayersControl.BaseLayer>
                    </LayersControl>

                    {/* Analysis Layers */}
                    <Pane name="plot-overlays" style={{ zIndex: 450 }}>
                        {showKiinteistot && <PropertyBoundariesLayer visible={showKiinteistot} />}
                        {showKorkeus && (
                            <WMSTileLayer
                                ref={korkeusLayerRef}
                                url="https://kartta.hsy.fi/geoserver/wms"
                                layers="maastotieto:vinovalovarjoste_2019"
                                format="image/png"
                                transparent={true}
                                version="1.1.1"
                                opacity={korkeusOpacity}
                            />
                        )}
                        {showMaapera && (
                            <WMSTileLayer
                                url="https://gtkdata.gtk.fi/arcgis/services/Rajapinnat/GTK_Maapera_WMS/MapServer/WMSServer"
                                layers="maapera_20k_pohjamaalajit"
                                format="image/png"
                                transparent={true}
                                version="1.3.0"
                                opacity={0.5}
                            />
                        )}
                        {showMelu && (
                            <WMSTileLayer
                                url="https://kartta.hsy.fi/geoserver/wms"
                                layers="asuminen_ja_maankaytto:Meluselvitys_2022_tieliikenne_Lden"
                                format="image/png"
                                transparent={true}
                                version="1.1.1"
                                opacity={0.6}
                            />
                        )}



                        {/* Main Plot Layer - only shows after search */}
                        {hasSearched && (
                            <WMSTileLayer
                                ref={wmsLayerRef}
                                url="https://kartta.hsy.fi/geoserver/asuminen_ja_maankaytto/wms"
                                layers="asuminen_ja_maankaytto:SeutuRAMAVA_kortteli_12025"
                                format="image/png"
                                transparent={true}
                                className="wms-red-tint"
                                opacity={wmsOpacity}
                            />
                        )}
                    </Pane>
                    <WMSUpdater cqlFilter={cqlFilter} opacity={wmsOpacity} layerRef={wmsLayerRef} />

                    {/* Custom Analysis Layers - outside Pane for UI visibility */}
                    <SalesAnalysisLayer visible={showSalesAnalysis} />
                </MapContainer>
            </div>

            {/* Modals - rendered outside MapContainer to prevent scroll event capture by Leaflet */}
            <AddPlotModal
                isOpen={isAddModalOpen}
                onClose={() => {
                    setIsAddModalOpen(false);
                    setEditingPlot(null);
                    setEditModalMode('add');
                }}
                onSave={savePlot}
                location={newPlotLocation}
                mode={editModalMode}
                existingPlot={editingPlot}
            />

            <NoteModal
                isOpen={isNoteModalOpen}
                onClose={() => {
                    setIsNoteModalOpen(false);
                    setNotePlotId(null);
                    setNotePlotName('');
                }}
                onSave={(note) => {
                    if (notePlotId) {
                        addNote(notePlotId, note);
                    }
                }}
                plotName={notePlotName}
            />

            <MarkSoldModal
                isOpen={isMarkSoldModalOpen}
                onClose={() => {
                    setIsMarkSoldModalOpen(false);
                    setPlotToMarkSold(null);
                }}
                onSave={handleMarkAsSoldSave}
                plot={plotToMarkSold}
            />

            <MarkOfferedModal
                isOpen={isMarkOfferedModalOpen}
                onClose={() => {
                    setIsMarkOfferedModalOpen(false);
                    setPlotToMarkOffered(null);
                }}
                onSave={handleMarkAsOfferedSave}
                plot={plotToMarkOffered}
            />

            <EditContactInfoModal
                isOpen={isEditContactModalOpen}
                onClose={() => { setIsEditContactModalOpen(false); setContactPlot(null); }}
                onSave={handleContactInfoSave}
                initialData={contactPlot ? getContactPersons(contactPlot) : []}
            />

            <LogContactModal
                isOpen={isLogContactModalOpen}
                onClose={() => setIsLogContactModalOpen(false)}
                onSave={handleLogContactSave}
                contactPersons={logContactPlot ? getContactPersons(logContactPlot) : []}
                currentAgent="Admin"
                onManageContacts={() => {
                    if (logContactPlot) {
                        setReturnToLogContact(true); // Enable return flow
                        setIsLogContactModalOpen(false);
                        openEditContactModal(logContactPlot);
                    }
                }}
                preselectedPersonId={logContactPreselectId}
            />

            {historyPlot && (
                <HistoryModal
                    isOpen={isHistoryModalOpen}
                    onClose={() => { setIsHistoryModalOpen(false); setHistoryPlot(null); }}
                    plot={historyPlot}
                />
            )}
        </div>
    );
}
