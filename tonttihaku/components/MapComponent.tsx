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
import AddPastPlotModal from './AddPastPlotModal';
import SalesAnalysisLayer from './SalesAnalysisLayer';
import BusinessPlotsLayer from './BusinessPlotsLayer';
import { ZONING_TYPES, getZoningColor, getPlotColor, STATUS_OPTIONS } from '@/lib/constants';
import { PlotData, PlotFilters, SalesFilters, BusinessPlotFilters, MarkSoldData, MarkOfferedData, ContactLog } from '@/types';
import * as api from '@/lib/api';
import MarkSoldModal from './MarkSoldModal';
import NoteModal from './NoteModal';
import MarkOfferedModal from './MarkOfferedModal';
import EditContactInfoModal from './EditContactInfoModal';
import LogContactModal from './LogContactModal';
import HistoryModal from './HistoryModal';
import AddressSearch, { AddressSearchResult } from './AddressSearch';

// Parse zonings from JSON string or legacy format
function parseZonings(plot: PlotData): { type: string, buildingRight: number }[] {
    if (plot.zonings) {
        try {
            const parsed = typeof plot.zonings === 'string' ? JSON.parse(plot.zonings) : plot.zonings;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [{ type: 'AK', buildingRight: plot.buildingRight || 0 }];
}

// Parse notes from JSON string
function parseNotes(plot: PlotData): { id: string, text: string, author: string, timestamp: string }[] {
    if (plot.notes) {
        try {
            const parsed = typeof plot.notes === 'string' ? JSON.parse(plot.notes) : plot.notes;
            if (Array.isArray(parsed)) return parsed;
        } catch { }
    }
    return [];
}

// Parse contacts from JSON string
function parseContacts(plot: PlotData): ContactLog[] {
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
    sale: PlotData;
    parseZonings: (plot: PlotData) => { type: string, buildingRight: number }[];
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
                    <p className="text-gray-500 text-xs">Kauppapäivä: {formatDate(sale.soldDate || '')}</p>
                    {sale.createdAt && (
                        <p className="text-gray-400 text-xs">Lisätty: {formatDate(sale.createdAt || '')} ({sale.createdBy || '-'})</p>
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

const ShareIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1">
        <circle cx="18" cy="5" r="3"></circle>
        <circle cx="6" cy="12" r="3"></circle>
        <circle cx="18" cy="19" r="3"></circle>
        <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
        <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
    </svg>
);

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
    const [showBusinessPlots, setShowBusinessPlots] = useState(false);

    const wmsLayerRef = useRef<L.TileLayer.WMS>(null);
    const korkeusLayerRef = useRef<L.TileLayer.WMS>(null);

    // Plots State
    const [showPlots, setShowPlots] = useState(false);
    const [addPlotMode, setAddPlotMode] = useState(false);
    const [addPastPlotMode, setAddPastPlotMode] = useState(false);
    const [plotsData, setPlotsData] = useState<PlotData[]>([]);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isAddPastPlotModalOpen, setIsAddPastPlotModalOpen] = useState(false);
    const [newPlotLocation, setNewPlotLocation] = useState<{ lat: number, lng: number } | null>(null);

    // Edit mode states
    const [editModalMode, setEditModalMode] = useState<'add' | 'edit'>('add');
    const [editingPlot, setEditingPlot] = useState<PlotData | null>(null);

    // Note modal state
    const [isNoteModalOpen, setIsNoteModalOpen] = useState(false);
    const [notePlotId, setNotePlotId] = useState<string | null>(null);
    const [notePlotName, setNotePlotName] = useState<string>('');

    // Mark Sold Modal State
    const [isMarkSoldModalOpen, setIsMarkSoldModalOpen] = useState(false);
    const [plotToMarkSold, setPlotToMarkSold] = useState<PlotData | null>(null);

    // Mark Offered Modal State
    const [isMarkOfferedModalOpen, setIsMarkOfferedModalOpen] = useState(false);
    const [plotToMarkOffered, setPlotToMarkOffered] = useState<PlotData | null>(null);

    // Contact Modals State
    const [isEditContactModalOpen, setIsEditContactModalOpen] = useState(false);
    const [contactPlot, setContactPlot] = useState<PlotData | null>(null);

    const [isLogContactModalOpen, setIsLogContactModalOpen] = useState(false);
    const [logContactPlot, setLogContactPlot] = useState<PlotData | null>(null);
    // Flow state: Return to log modal after adding contact
    const [returnToLogContact, setReturnToLogContact] = useState(false);
    const [logContactPreselectId, setLogContactPreselectId] = useState<string | undefined>(undefined);

    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false);
    const [historyPlot, setHistoryPlot] = useState<PlotData | null>(null);

    // Plot filters state
    const [plotFilters, setPlotFilters] = useState<PlotFilters>({
        zoningTypes: ZONING_TYPES.map(z => z.code),
        buildingRightMin: '',
        buildingRightMax: '',
        status: 'Vapaa,Kilpailussa,Tarjottu,Pidossa',
        kunnat: [],
        priorities: [],
        materials: []
    });

    // Sales filters state
    const [salesFilters, setSalesFilters] = useState<SalesFilters>({
        zoningTypes: [],
        buildingRightMin: '',
        buildingRightMax: ''
    });

    // Business Plot filters state
    const [businessPlotFilters, setBusinessPlotFilters] = useState<BusinessPlotFilters>({
        minArea: '',
        maxArea: '',
        minBuildRight: '',
        maxBuildRight: '',
        usage: []
    });
    const [businessUsageOptions, setBusinessUsageOptions] = useState<string[]>([]);

    const [showKiinteistot, setShowKiinteistot] = useState(false);
    const [showAsemakaavaInfo, setShowAsemakaavaInfo] = useState(false);
    const [popupInfo, setPopupInfo] = useState<{ lat: number, lng: number, content: string } | null>(null);
    const [isPanelOpen, setIsPanelOpen] = useState(true);

    // Close panel by default on mobile
    useEffect(() => {
        if (typeof window !== 'undefined' && window.innerWidth < 768) {
            setIsPanelOpen(false);
        }
    }, []);

    // Plot search: marker refs for programmatic popup opening
    const markerRefs = useRef<Map<string, L.Marker>>(new Map());
    const [selectedPlotId, setSelectedPlotId] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Sales State
    const [showSales, setShowSales] = useState(false);
    const [showApartments, setShowApartments] = useState(false);
    const [editMode, setEditMode] = useState(false);
    // salesData is derived from plotsData in render/useMemo
    const [apartmentData, setApartmentData] = useState<any[]>([]);

    const [searchMarker, setSearchMarker] = useState<AddressSearchResult | null>(null);

    // Check for shared plot in URL on mount
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const sharedPlotId = params.get('plot');
            if (sharedPlotId) {
                setShowPlots(true); // Ensure plots are loaded
                setSelectedPlotId(sharedPlotId);

                // Remove the parameter from the URL so it doesn't trigger again on re-renders/filter changes
                params.delete('plot');
                const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '');
                window.history.replaceState({}, '', newUrl);
            }
        }
    }, []);

    // Fetch plots data (contains both active and sold plots)
    useEffect(() => {
        if (showPlots || showSales) {
            api.fetchPlots()
                .then(plots => setPlotsData(plots))
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
            api.fetchApartments()
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
            // Always show the specifically searched plot regardless of filters
            if (selectedPlotId && plot.id === selectedPlotId) return true;

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

            // Apply priority filter
            if (plotFilters.priorities && plotFilters.priorities.length > 0) {
                const plotPriority = plot.priority || 0;
                if (!plotFilters.priorities.includes(plotPriority)) return false;
            }

            // Apply material filter ('' = unknown/not classified)
            if (plotFilters.materials && plotFilters.materials.length > 0) {
                const plotMaterial = plot.material || '';
                if (!plotFilters.materials.includes(plotMaterial)) return false;
            }

            return true;
        });
    }, [plotsData, plotFilters, selectedPlotId]);

    // Handle plot selection from search
    const handlePlotSelect = (plot: PlotData | null) => {
        if (!plot) {
            setSelectedPlotId(null);
            return;
        }
        // Ensure plots layer is visible
        if (!showPlots) setShowPlots(true);
        setSelectedPlotId(plot.id);
    };

    // Helper component to fly to an address search result
    function FlyToSearch() {
        const map = useMap();
        useEffect(() => {
            if (searchMarker) {
                map.flyTo([parseFloat(searchMarker.lat), parseFloat(searchMarker.lon)], 16, { animate: true, duration: 1.5 });
            }
        }, [searchMarker, map]);
        return null;
    }

    // Helper component to fly to a selected plot and open its popup
    function FlyToPlot() {
        const map = useMap();
        useEffect(() => {
            if (!selectedPlotId) return;
            const plot = plotsData.find(p => p.id === selectedPlotId);
            if (!plot || !plot.lat || !plot.lng) {
                // Don't clear selectedPlotId here, wait for plotsData to load
                return;
            }
            map.flyTo([plot.lat, plot.lng], 16, { duration: 0.8 });

            // Try to open the popup multiple times as the marker might take a moment to render
            let attempts = 0;
            const maxAttempts = 5;

            const tryOpenPopup = () => {
                attempts++;
                const marker = markerRefs.current.get(selectedPlotId);
                if (marker) {
                    marker.openPopup();
                    // Clear the selection so that modifying the plot (which updates plotsData) 
                    // doesn't cause the map to fly back here and re-open the popup.
                    setSelectedPlotId(null);
                } else if (attempts < maxAttempts) {
                    setTimeout(tryOpenPopup, 500); // Try again in 500ms
                }
            };

            // Start trying after fly animation is mostly done
            const timer = setTimeout(tryOpenPopup, 900);

            return () => {
                clearTimeout(timer);
            };
        }, [selectedPlotId, map, plotsData]);
        return null;
    }

    // Save plot (add or update)
    const savePlot = async (plot: Partial<PlotData>, action: 'add' | 'update') => {
        try {
            const data = await api.savePlot(plot, action);
            if (data.success && data.plots) {
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
    const addNoteToPlot = async (plotId: string, note: { text: string, author: string }) => {
        try {
            const data = await api.addNote(plotId, note);
            if (data.success && data.plots) {
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
    const openEditModal = (plot: PlotData) => {
        setEditingPlot(plot);
        setEditModalMode('edit');
        setIsAddModalOpen(true);
    };

    const openMarkAsSoldModal = (plot: PlotData) => {
        setPlotToMarkSold(plot);
        setIsMarkSoldModalOpen(true);
    };

    const handleMarkAsSoldSave = async (salesData: MarkSoldData) => {
        if (!plotToMarkSold) return;

        const updatedPlot = {
            ...plotToMarkSold,
            status: 'Mennyt',
            buyer: salesData.buyer,
            finalPrice: salesData.finalPrice,
            pricePerRight: salesData.pricePerRight,
            soldDate: salesData.soldDate,
            updatedBy: salesData.updatedBy, // Save who marked it as sold
            desc: salesData.desc ? (plotToMarkSold.desc ? plotToMarkSold.desc + '\n\n' + salesData.desc : salesData.desc) : plotToMarkSold.desc
        };

        await savePlot(updatedPlot, 'update');
        setPlotToMarkSold(null);
    };

    const openMarkAsOfferedModal = (plot: PlotData) => {
        setPlotToMarkOffered(plot);
        setIsMarkOfferedModalOpen(true);
    };

    const handleMarkAsOfferedSave = async (offerData: MarkOfferedData) => {
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
    const getContactPersons = (plot: PlotData) => {
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
    const openEditContactModal = (plot: PlotData) => {
        setContactPlot(plot);
        setIsEditContactModalOpen(true);
    };

    const handleContactInfoSave = async (contactPersons: { id: string; name: string; phone?: string; email?: string }[]) => {
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

    const openLogContactModal = (plot: PlotData) => {
        setLogContactPlot(plot);
        setIsLogContactModalOpen(true);
    };

    const handleLogContactSave = async (log: { date: string; desc: string; agent: string; person: string; personId?: string }) => {
        if (!logContactPlot) return;

        try {
            const data = await api.addContactLog(logContactPlot.id, {
                date: log.date,
                desc: log.desc,
                agent: log.agent,
                method: 'Muu',
                person: log.person || logContactPlot.contactPerson || 'Ei määritelty',
            });
            if (data.success && data.plots) {
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

    const openHistoryModal = (plot: PlotData) => {
        setHistoryPlot(plot);
        setIsHistoryModalOpen(true);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                if (isAddModalOpen || isAddPastPlotModalOpen) return;
                setNewPlotLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
                setEditModalMode('add');
                setEditingPlot(null);
                setIsAddModalOpen(true);
            };

            const onAddPastPlotClick = (e: L.LeafletMouseEvent) => {
                if (isAddModalOpen || isAddPastPlotModalOpen) return;
                setNewPlotLocation({ lat: e.latlng.lat, lng: e.latlng.lng });
                setIsAddPastPlotModalOpen(true);
            };

            if (editMode) {
                // 'editMode' was previously for Sales layer editing.
                // We'll map this to onAddPlotClick behavior for consistency or disable it if preferred.
                // User requirement: "the once we manually add in the tunnetut tontit section are the onces that we are actually interested"
                // So adding sales directly might be less important, but let's keep it functional as adding a plot
                map.on('click', onAddPlotClick);
            } else if (addPastPlotMode) {
                map.on('click', onAddPastPlotClick);
            } else if (addPlotMode) {
                map.on('click', onAddPlotClick);
            } else {
                map.on('click', onClick);
            }

            return () => {
                map.off('click', onClick);
                map.off('click', onAddPlotClick);
                map.off('click', onAddPastPlotClick);
            };
        }, [map, showKiinteistot, showAsemakaavaInfo, editMode, addPlotMode, addPastPlotMode, isAddModalOpen, isAddPastPlotModalOpen]);

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
        if (layer === 'business_plots') setShowBusinessPlots(visible);

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
            if (showPlots) {
                setAddPlotMode(visible);
                if (!visible) setAddPastPlotMode(false);
            } else {
                if (visible) alert("Ota ensin 'Tunnetut tontit' -taso käyttöön.");
                setAddPlotMode(false);
                setAddPastPlotMode(false);
            }
        }
        if (layer === 'add_past_plot_mode') {
            if (showPlots && addPlotMode) setAddPastPlotMode(visible);
            else setAddPastPlotMode(false);
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
        <div className="flex w-full h-full overflow-hidden">
            <FilterPanel
                isOpen={isPanelOpen}
                onToggle={() => setIsPanelOpen(!isPanelOpen)}
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
                    add_past_plot_mode: addPastPlotMode,
                    sales_analysis: showSalesAnalysis,
                    business_plots: showBusinessPlots
                }}
                onPlotFiltersChange={setPlotFilters}
                onSalesFiltersChange={setSalesFilters}
                onBusinessPlotFiltersChange={setBusinessPlotFilters}
                businessPlotFilters={businessPlotFilters}
                businessUsageOptions={businessUsageOptions}
                visiblePlots={visiblePlots}
                availableKunnat={availableKunnat}
                plotsData={plotsData}
                onPlotSelect={handlePlotSelect}
            />
            <div className="flex-grow h-full relative z-0">
                {!isPanelOpen && (
                    <button
                        onClick={() => setIsPanelOpen(true)}
                        className="absolute top-4 left-4 z-[1000] bg-white p-3 rounded-xl shadow-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 transition-all flex items-center gap-2 group"
                        title="Näytä valikko"
                    >
                        <svg className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors hidden sm:block">Valikko</span>
                    </button>
                )}

                <AddressSearch onSelect={setSearchMarker} />

                <MapContainer center={[60.25, 24.8]} zoom={10} style={{ height: '100%', width: '100%' }}>
                    <MapEvents />
                    <FlyToPlot />
                    <FlyToSearch />
                    {searchMarker && (
                        <Marker position={[parseFloat(searchMarker.lat), parseFloat(searchMarker.lon)]}>
                            <Popup>{searchMarker.display_name}</Popup>
                        </Marker>
                    )}
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

                        // Style configuration — all markers use unified pill shape, only color varies
                        const plotColor = getPlotColor(plot.status, zonings[0]?.type || 'AK');
                        const isSold = plot.status === 'Mennyt';

                        // Base styles — unified pill for all statuses
                        const pillPadding = '5px 9px';
                        const pillFontSize = Math.max(10, markerSize / 4);
                        const pillOpacity = isSold ? '0.65' : '1';
                        const pillShadowColor = isSold ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.25)';
                        const pillFontWeight = isSold ? 'normal' : 'bold';

                        let markerHtml = `<div style="
                            background-color: ${plotColor};
                            color: white;
                            padding: ${pillPadding};
                            border-radius: 9999px;
                            border: 2px solid white;
                            box-shadow: 0 2px 6px ${pillShadowColor};
                            display: flex;
                            flex-direction: column;
                            justify-content: center;
                            align-items: center;
                            font-weight: ${pillFontWeight};
                            font-size: ${pillFontSize}px;
                            min-width: ${markerSize}px;
                            text-align: center;
                            opacity: ${pillOpacity};
                            white-space: nowrap;
                        ">
                            <div style="line-height:1.1;">${label}</div>
                            <div style="font-size:0.78em; opacity:0.9; margin-top:1px;">${totalBR.toLocaleString()}</div>
                            ${isSold && plot.pricePerRight && plot.pricePerRight > 0
                                ? `<div style='font-size:0.72em; opacity:0.8; margin-top:1px;'>${plot.pricePerRight.toLocaleString()} €</div>`
                                : !isSold && unitPrice
                                    ? `<div style='font-size:0.72em; background:rgba(0,0,0,0.15); padding:0 4px; border-radius:20px; margin-top:2px;'>${unitPrice.toLocaleString()} €</div>`
                                    : ''
                            }
                        </div>`;

                        let anchor: [number, number] = [(markerSize + 10) / 2, (markerSize + 10) / 2];
                        let size: [number, number] = [markerSize + 10, markerSize + 10];

                        return (
                            <Marker
                                key={plot.id || i}
                                position={[plot.lat, plot.lng]}
                                ref={(ref) => {
                                    if (ref && plot.id) markerRefs.current.set(plot.id, ref);
                                }}
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

                                        {/* SOLD PLOT SPECIFIC LAYOUT */}
                                        {plot.status === 'Mennyt' ? (
                                            <div className="space-y-2 mt-2">
                                                <p className={`font-bold ${getStatusColor(plot.status)}`}>{plot.status}</p>

                                                {/* Zoning breakdown (Same as original) */}
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

                                                <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-gray-700 mt-2">
                                                    <span>Kauppapäivä:</span>
                                                    <span className="font-medium">{plot.soldDate ? formatDate(plot.soldDate) : '-'}</span>

                                                    <span>Kem kauppahinta:</span>
                                                    <span className="font-medium">{plot.pricePerRight ? `${plot.pricePerRight.toLocaleString()} €/k-m²` : '-'}</span>

                                                    <span>Kokonaishinta:</span>
                                                    <span className="font-bold text-gray-900">{plot.finalPrice ? `${plot.finalPrice.toLocaleString()} €` : '-'}</span>
                                                </div>

                                                {plot.desc && (
                                                    <div className="mt-2 text-sm text-gray-700 bg-blue-50/50 p-2 rounded border border-blue-100/50 italic">
                                                        "{plot.desc}"
                                                    </div>
                                                )}
                                            </div>
                                        ) : (
                                            /* STANDARD PLOT LAYOUT */
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
                                                    {plot.material && (
                                                        <>
                                                            <span>Materiaali:</span>
                                                            <span className={`font-medium ${plot.material === 'Puu' ? 'text-amber-700' : ''}`}>
                                                                {plot.material}
                                                            </span>
                                                        </>
                                                    )}
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
                                                                                        {(item as any).agent}
                                                                                    </span>
                                                                                </div>
                                                                                {/* Subheader: Contact Person */}
                                                                                <div className="text-[10px] text-gray-600 mb-1 font-medium">
                                                                                    {(item as any).person || 'Tuntematon'}
                                                                                </div>
                                                                                {/* Body: Comment */}
                                                                                <p className="text-gray-800">
                                                                                    {(item as any).desc}
                                                                                </p>
                                                                            </>
                                                                        ) : (
                                                                            <>
                                                                                <div className="flex justify-between items-center mb-0.5">
                                                                                    <span className="font-semibold text-yellow-700">
                                                                                        {formatDate(item.date)}
                                                                                    </span>
                                                                                    <span className="text-[10px] text-gray-400">
                                                                                        {(item as any).author}
                                                                                    </span>
                                                                                </div>
                                                                                <p className="text-gray-700">
                                                                                    {(item as any).text}
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
                                                    {/* Common Action Buttons */}
                                                    <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
                                                        <button
                                                            onClick={async () => {
                                                                const url = `${window.location.origin}${window.location.pathname}?plot=${plot.id}`;
                                                                try {
                                                                    await navigator.clipboard.writeText(url);
                                                                    setCopiedId(plot.id);
                                                                    setTimeout(() => setCopiedId(null), 2000);
                                                                } catch (err) {
                                                                    console.error('Failed to copy link', err);
                                                                }
                                                            }}
                                                            className="flex-1 flex items-center justify-center px-2 py-1 text-[10px] font-medium text-purple-700 bg-purple-50 border border-purple-200 rounded hover:bg-purple-100"
                                                        >
                                                            {copiedId === plot.id ? 'Kopioitu!' : <><ShareIcon /> Jaa</>}
                                                        </button>
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
                                        )}
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
                    <BusinessPlotsLayer
                        visible={showBusinessPlots}
                        filters={businessPlotFilters}
                        onFiltersChange={setBusinessPlotFilters}
                        onUsageOptionsLoaded={setBusinessUsageOptions}
                    />

                    {/* Popups (for WMS) */}
                    {popupInfo && (
                        <Popup position={[popupInfo.lat, popupInfo.lng]} eventHandlers={{ remove: () => setPopupInfo(null) }}>
                            <div dangerouslySetInnerHTML={{ __html: popupInfo.content }} />
                        </Popup>
                    )}
                </MapContainer>

                {/* Deployment version trigger: Fix regression v2 */}
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

            <AddPastPlotModal
                isOpen={isAddPastPlotModalOpen}
                onClose={() => setIsAddPastPlotModalOpen(false)}
                onSave={savePlot}
                location={newPlotLocation}
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
                        addNoteToPlot(notePlotId, note);
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
