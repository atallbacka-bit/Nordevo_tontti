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
import { MapContainer, TileLayer, WMSTileLayer, useMap, Marker, Popup, Pane, GeoJSON } from 'react-leaflet';
import MarkerClusterGroup from 'react-leaflet-cluster';
import 'leaflet/dist/leaflet.css';
import 'react-leaflet-cluster/lib/assets/MarkerCluster.css';
import L from 'leaflet';
import FilterPanel from './FilterPanel';
import AddPlotModal from './AddPlotModal';
import AddPastPlotModal from './AddPastPlotModal';
import SthMarketLayer from './SthMarketLayer';
import BusinessPlotsLayer from './BusinessPlotsLayer';
import { ZONING_TYPES, getZoningColor, getStatusAccent } from '@/lib/constants';
import { PlotData, PlotFilters, SalesFilters, BusinessPlotFilters, MarkSoldData, MarkOfferedData } from '@/types';
import * as api from '@/lib/api';
import MarkSoldModal from './MarkSoldModal';
import NoteModal from './NoteModal';
import MarkOfferedModal from './MarkOfferedModal';
import EditContactInfoModal from './EditContactInfoModal';
import LogContactModal from './LogContactModal';
import HistoryModal from './HistoryModal';
import AddressSearch, { AddressSearchResult } from './AddressSearch';
import PlotPopupCard from './PlotPopupCard';
import { parseZonings, getContactPersons, formatDate, formatShortDate } from '@/lib/plotUtils';
import { useT } from '@/lib/i18n';

// Selectable basemaps for the map-corner switcher
const BASE_LAYERS: { id: string; label: string }[] = [
    { id: 'light', label: 'Vaalea' },
    { id: 'osm', label: 'Värillinen' },
    { id: 'satellite', label: 'Satelliitti' },
    { id: 'kaava-hki', label: 'Asemakaava · Helsinki' },
    { id: 'kaava-espoo', label: 'Asemakaava · Espoo' },
    { id: 'kaava-vantaa', label: 'Asemakaava · Vantaa' },
];

// Cluster badge: white circle sized by member count
function createClusterIcon(cluster: any) {
    const count = cluster.getChildCount();
    const size = count < 10 ? 34 : count < 50 ? 40 : 46;
    return L.divIcon({
        html: `<div class="plot-cluster" style="width:${size}px;height:${size}px;">${count}</div>`,
        className: 'custom-plot-icon',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2]
    });
}


// Get zoning label for marker
function getZoningLabel(zonings: { type: string, buildingRight: number }[]): string {
    if (zonings.length === 1) return zonings[0].type;
    return zonings.map(z => z.type).join('/');
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
    const t = useT();
    const [showDetails, setShowDetails] = useState(false);
    const zonings = parseZonings(sale);
    const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || sale.buildingRight || 0;

    return (
        <div className="text-sm min-w-[220px]">
            {/* Essential info - always visible */}
            <h3 className="font-bold text-lg mb-1">{sale.name || sale.address}</h3>

            {sale.updatedBy && (
                <p className="text-gray-500 text-xs mb-2">{t('Kirjaaja')}: {sale.updatedBy}</p>
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
                            <span>{t('Yhteensä')}</span>
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
                {showDetails ? t('▲ Piilota lisätiedot') : t('▼ Lisää tarkentavia tietoja')}
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
    const t = useT();
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
                                <b>{t('Kiinteistö:')}</b><br/>
                                <span style="font-size: 14px; font-weight: 500;">${propertyId}</span>
                            </div>
                            <a href="${autoSearchUrl}" target="_blank" 
                               style="display: block; width: 100%; padding: 8px; background: #0066cc; color: white; 
                                      text-align: center; text-decoration: none; border-radius: 4px; font-size: 13px; font-weight: 500; box-sizing: border-box;">
                                {t('Avaa karttapalvelussa →')}
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
    const t = useT();
    const [cqlFilter, setCqlFilter] = useState('laskvar_ak < 0 AND laskvar_ap < 0');
    const [hasSearched, setHasSearched] = useState(false);
    const [wmsOpacity, setWmsOpacity] = useState(1.0);
    const [korkeusOpacity, setKorkeusOpacity] = useState(0.7);

    const [showMaapera, setShowMaapera] = useState(false);
    const [showMelu, setShowMelu] = useState(false);
    const [showKorkeus, setShowKorkeus] = useState(false);
    const [showSthProjects, setShowSthProjects] = useState(false);
    const [showSthHeatmap, setShowSthHeatmap] = useState(false);
    const [showSthAdvisor, setShowSthAdvisor] = useState(false);
    const [showSthPlans, setShowSthPlans] = useState(false);
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
    const [baseLayer, setBaseLayer] = useState('light');
    const [baseMenuOpen, setBaseMenuOpen] = useState(false);
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

    // Sales State
    const [showSales, setShowSales] = useState(false);
    const [showApartments, setShowApartments] = useState(false);
    const [editMode, setEditMode] = useState(false);
    // salesData is derived from plotsData in render/useMemo
    const [apartmentData, setApartmentData] = useState<any[]>([]);

    const [searchMarker, setSearchMarker] = useState<AddressSearchResult | null>(null);
    // Current map center for biasing address search results toward the visible area
    const mapCenterRef = useRef<{ lat: number; lng: number }>({ lat: 60.25, lng: 24.8 });

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

    // Helper component to keep mapCenterRef in sync with the map view
    function TrackMapCenter() {
        const map = useMap();
        useEffect(() => {
            const update = () => { mapCenterRef.current = map.getCenter(); };
            update();
            map.on('moveend', update);
            return () => { map.off('moveend', update); };
        }, [map]);
        return null;
    }

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
                alert(t('Virhe tallennuksessa') + ': ' + (data.error || t('Tuntematon virhe')));
            }
        } catch (err) {
            console.error(err);
            alert(t('Virhe tallennuksessa') + ': ' + err);
        }
    };

    // Add note to plot
    const addNoteToPlot = async (plotId: string, note: { text: string, author: string }) => {
        try {
            const data = await api.addNote(plotId, note);
            if (data.success && data.plots) {
                setPlotsData(data.plots);
            } else {
                alert(t('Virhe muistiinpanon tallennuksessa') + ': ' + (data.error || t('Tuntematon virhe')));
            }
        } catch (err) {
            console.error(err);
            alert(t('Virhe muistiinpanon tallennuksessa') + ': ' + err);
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
                alert(t('Virhe tallennuksessa.'));
            }
        } catch (err) {
            console.error(err);
            alert(t('Virhe tallennuksessa.'));
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
        const t = useT();
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
                        if (text && text.length > 100) content += `<b>{t('Asemakaava:')}</b><br />${sanitizeHtml(text)}<br />`;
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
        if (layer === 'sth_projects') setShowSthProjects(visible);
        if (layer === 'sth_heatmap') setShowSthHeatmap(visible);
        if (layer === 'sth_analysis') setShowSthAdvisor(visible);
        if (layer === 'sth_plans') setShowSthPlans(visible);
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
                if (visible) alert(t("Ota ensin 'Myydyt tontit' -taso käyttöön."));
                setEditMode(false);
            }
        }
        if (layer === 'add_plot_mode') {
            if (showPlots) {
                setAddPlotMode(visible);
                if (!visible) setAddPastPlotMode(false);
            } else {
                if (visible) alert(t("Ota ensin 'Tunnetut tontit' -taso käyttöön."));
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
                    sth_projects: showSthProjects,
                    sth_heatmap: showSthHeatmap,
                    sth_analysis: showSthAdvisor,
                    sth_plans: showSthPlans,
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
                        title={t('Näytä valikko')}
                    >
                        <svg className="w-5 h-5 text-slate-600 group-hover:text-blue-600 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                        </svg>
                        <span className="text-sm font-semibold text-slate-700 group-hover:text-blue-700 transition-colors hidden sm:block">{t('Valikko')}</span>
                    </button>
                )}

                <AddressSearch onSelect={setSearchMarker} getFocusPoint={() => mapCenterRef.current} />

                {/* Basemap switcher */}
                <div className="absolute top-[12px] right-[12px] z-[1000]">
                    <button
                        onClick={() => setBaseMenuOpen(!baseMenuOpen)}
                        className={`flex items-center justify-center w-[38px] h-[38px] bg-white rounded-md shadow-md border transition-colors ${baseMenuOpen ? 'border-blue-400 text-blue-600' : 'border-slate-200 text-slate-600 hover:text-slate-900'}`}
                        title={t('Karttapohja')}
                        aria-label={t('Vaihda karttapohja')}
                    >
                        <svg className="w-[18px] h-[18px]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M12 3l9 5-9 5-9-5 9-5z" />
                            <path strokeLinecap="round" strokeLinejoin="round" d="M3 12.5l9 5 9-5M3 16.5l9 5 9-5" opacity="0.55" />
                        </svg>
                    </button>
                    {baseMenuOpen && (
                        <div className="absolute right-0 mt-1.5 w-52 bg-white border border-slate-200 rounded-lg shadow-lg py-1.5">
                            <div className="px-3 pb-1 pt-0.5 text-[10px] font-bold text-slate-400 uppercase tracking-[0.07em]">{t('Karttapohja')}</div>
                            {BASE_LAYERS.map(bl => (
                                <button
                                    key={bl.id}
                                    onClick={() => { setBaseLayer(bl.id); setBaseMenuOpen(false); }}
                                    className={`w-full flex items-center justify-between text-left px-3 py-1.5 text-[12.5px] transition-colors ${baseLayer === bl.id ? 'text-blue-700 font-semibold bg-blue-50/60' : 'text-slate-700 hover:bg-slate-50'}`}
                                >
                                    {t(bl.label)}
                                    {baseLayer === bl.id && (
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <MapContainer center={[60.25, 24.8]} zoom={10} style={{ height: '100%', width: '100%' }}>
                    <MapEvents />
                    <TrackMapCenter />
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
                                    icon={L.divIcon({
                                        className: 'custom-plot-icon',
                                        html: `<div class="plot-pin-center"><div class="plot-pill plot-sold">
                                            <span class="plot-pill-dot" style="background:${getStatusAccent('Mennyt')};"></span>
                                            <span>${sale.pricePerRight && sale.pricePerRight > 0 ? `${sale.pricePerRight.toLocaleString('fi-FI')} €/kem` : (sale.finalPrice ? `${sale.finalPrice.toLocaleString('fi-FI')} €` : 'Myyty')}</span>
                                        </div></div>`,
                                        iconSize: [0, 0],
                                        iconAnchor: [0, 0],
                                        popupAnchor: [0, -16]
                                    })}
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
                                    className: 'custom-plot-icon',
                                    html: `<div class="plot-pin-center"><div class="plot-pill">
                                        <span class="plot-pill-dot" style="background:#10b981;"></span>
                                        <span>${apt.pricePerSqm?.toLocaleString('fi-FI')} €/m²</span>
                                    </div></div>`,
                                    iconSize: [0, 0],
                                    iconAnchor: [0, 0],
                                    popupAnchor: [0, -16]
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

                    {/* Plots Markers — clustered when overlapping */}
                    {showPlots && (
                    <MarkerClusterGroup
                        chunkedLoading
                        maxClusterRadius={50}
                        showCoverageOnHover={false}
                        spiderfyOnMaxZoom={true}
                        disableClusteringAtZoom={15}
                        iconCreateFunction={createClusterIcon}
                    >
                    {visiblePlots.map((plot, i) => {
                        if (!plot.lat || !plot.lng) return null;
                        const zonings = parseZonings(plot);

                        const totalBR = zonings.reduce((sum, z) => sum + (z.buildingRight || 0), 0) || plot.buildingRight || 0;
                        const label = getZoningLabel(zonings);

                        const priceToUse = (plot.status === 'Tarjottu' && plot.offerPrice) ? plot.offerPrice : plot.priceEst;
                        const unitPrice = (priceToUse && totalBR) ? Math.round(priceToUse / totalBR) : null;

                        const accent = getStatusAccent(plot.status);
                        const isSold = plot.status === 'Mennyt';
                        const isCompetition = plot.status === 'Kilpailussa' && plot.deadline;

                        // Secondary segment: deadline for competitions, otherwise unit price
                        const info = isSold
                            ? (plot.pricePerRight && plot.pricePerRight > 0 ? `${plot.pricePerRight.toLocaleString('fi-FI')} €` : '')
                            : isCompetition
                                ? `DL ${formatShortDate(plot.deadline!)}`
                                : (unitPrice ? `${unitPrice.toLocaleString('fi-FI')} €` : '');
                        const infoColor = isCompetition ? '#dc2626' : '#64748b';

                        // Quiet white pill: status dot + zoning-colored type badge + k-m² + price/DL
                        const zoneColor = getZoningColor(zonings[0]?.type || 'AK');
                        const markerHtml = `<div class="plot-pin-center"><div class="plot-pill${isSold ? ' plot-sold' : ''}">
                            <span class="plot-pill-dot" style="background:${accent};"></span>
                            <span class="plot-pill-zone" style="background:${zoneColor};">${label}</span>
                            ${totalBR ? `<span>${totalBR.toLocaleString('fi-FI')}</span>` : ''}
                            ${info ? `<span class="plot-pill-info" style="color:${infoColor};">${info}</span>` : ''}
                        </div></div>`;

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
                                    iconSize: [0, 0],
                                    iconAnchor: [0, 0],
                                    popupAnchor: [0, -16]
                                })}
                            >
                                <Popup className="plot-popup" minWidth={300} maxWidth={300}>
                                    <PlotPopupCard
                                        plot={plot}
                                        onEdit={openEditModal}
                                        onMarkSold={openMarkAsSoldModal}
                                        onMarkOffered={openMarkAsOfferedModal}
                                        onEditContacts={openEditContactModal}
                                        onLogContact={openLogContactModal}
                                        onAddNote={openNoteModal}
                                        onShowHistory={openHistoryModal}
                                    />
                                </Popup>
                            </Marker>
                        );
                    })}
                    </MarkerClusterGroup>
                    )}

                    {/* Basemap — driven by the corner switcher */}
                    {baseLayer === 'light' && (
                        <TileLayer
                            key="base-light"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                            url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                        />
                    )}
                    {baseLayer === 'osm' && (
                        <TileLayer
                            key="base-osm"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                    )}
                    {baseLayer === 'satellite' && (
                        <TileLayer
                            key="base-sat"
                            attribution='Tiles &copy; Esri'
                            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                        />
                    )}
                    {baseLayer === 'kaava-hki' && (
                        <WMSTileLayer
                            key="base-kaava-hki"
                            url="https://kartta.hel.fi/ws/geoserver/avoindata/wms"
                            layers="Ajantasa_asemakaava_maanpaallinen_varillinen"
                            format="image/png"
                            transparent={true}
                        />
                    )}
                    {baseLayer === 'kaava-espoo' && (
                        <WMSTileLayer
                            key="base-kaava-espoo"
                            url="https://kartat.espoo.fi/teklaogcweb/wms.ashx"
                            layers="Ajantasa_asemakaava_vektori"
                            format="image/png"
                            transparent={true}
                            version="1.1.1"
                        />
                    )}
                    {baseLayer === 'kaava-vantaa' && (
                        <WMSTileLayer
                            key="base-kaava-vantaa"
                            url="https://gis.vantaa.fi/geoserver/wms"
                            layers="kaava:asemakaavahakemisto,kaava:asemakaava_mv"
                            format="image/png"
                            transparent={true}
                        />
                    )}

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
                    <SthMarketLayer
                        showProjects={showSthProjects}
                        showHeatmap={showSthHeatmap}
                        advisorOn={showSthAdvisor}
                        showPlans={showSthPlans}
                    />
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
