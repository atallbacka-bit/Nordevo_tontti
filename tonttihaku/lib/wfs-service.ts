const WFS_BASE_URL = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs';

export interface BusinessPlot {
    id: number;
    jhs_tunnus: string;
    osoite: string;
    pinta_ala: string;
    rakennusoikeus: string;
    kayttotarkoitusmerkinta: string;
    kayttotarkoitus_selite: string;
    lisatietoja: string | null;
    luokka: string;
    e: string;
    n: string;
    paivitetty_tietopalveluun: string;
    datanomistaja: string;
    geometry: any; // GeoJSON geometry (Point from original, Polygon from joined)
    locationGeometry?: any; // The original Point geometry
    isPolygon?: boolean;
}

export async function fetchBusinessPlots(): Promise<BusinessPlot[]> {
    try {
        // 1. Fetch Vapaat_yritystontit (Points with attributes)
        // Use EPSG:4326 for easy Leaflet compatibility
        const plotsUrl = `${WFS_BASE_URL}?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Vapaat_yritystontit&outputFormat=application/json&srsName=EPSG:4326`;

        const plotsRes = await fetch(plotsUrl);
        if (!plotsRes.ok) throw new Error('Failed to fetch business plots');

        const plotsJson = await plotsRes.json();
        const features = plotsJson.features || [];

        // 2. Extract Kiinteistötunnus IDs for polygon fetching
        // jhs_tunnus format: "091-016-0748-0004" -> kiinteistotunnus format: "09101607480004"
        const propertyIds = new Set<string>();
        const plotsMap = new Map<string, any>();

        features.forEach((f: any) => {
            if (f.properties?.jhs_tunnus) {
                const rawId = f.properties.jhs_tunnus;
                const cleanId = rawId.replace(/-/g, '');
                propertyIds.add(cleanId);
                // Map both ID formats to the feature for easier lookup later
                plotsMap.set(cleanId, f);
            }
        });

        if (propertyIds.size === 0) return features.map((f: any) => ({ ...f.properties, geometry: f.geometry }));

        // 3. Fetch Kiinteisto_alue (Polygons)
        // We need to utilize CQL_FILTER or featureID filtering if possible, or just fetch by attribute kiinteistotunnus
        // WFS 2.0 supports 'cql_filter' in Geoserver
        // Construct filter: kiinteistotunnus IN ('id1', 'id2', ...)
        const idList = Array.from(propertyIds).map(id => `'${id}'`).join(',');
        const cqlFilter = `kiinteistotunnus IN (${idList})`;

        const polygonsUrl = `${WFS_BASE_URL}?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Kiinteisto_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(cqlFilter)}`;

        const polyRes = await fetch(polygonsUrl);
        let polyJson: any;
        if (polyRes.ok) {
            polyJson = await polyRes.json();
        } else {
            console.error('Failed to fetch polygons', await polyRes.text());
        }

        // 4. Merge Data
        const mergedPlots: BusinessPlot[] = features.map((f: any) => {
            const props = f.properties;
            const cleanId = props.jhs_tunnus?.replace(/-/g, '') || '';

            // Find matching polygon
            const polygonFeature = polyJson?.features?.find((pf: any) => pf.properties.kiinteistotunnus === cleanId);

            return {
                ...props,
                locationGeometry: f.geometry, // Original Point
                geometry: polygonFeature ? polygonFeature.geometry : f.geometry, // Use Polygon if available, else Point
                isPolygon: !!polygonFeature
            };
        });

        return mergedPlots;

    } catch (err) {
        console.error('Error fetching business plots:', err);
        return [];
    }
}
