const HELSINKI_WFS_BASE_URL = 'https://kartta.hel.fi/ws/geoserver/avoindata/wfs';
const ESPOO_WFS_BASE_URL = 'https://kartat.espoo.fi/teklaogcweb/wfs.ashx';

export interface BusinessPlot {
    id: number | string; // Espoo IDs might be strings
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

async function fetchHelsinkiBusinessPlots(): Promise<BusinessPlot[]> {
    try {
        // 1. Fetch Vapaat_yritystontit (Points with attributes)
        // Use EPSG:4326 for easy Leaflet compatibility
        const plotsUrl = `${HELSINKI_WFS_BASE_URL}?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Vapaat_yritystontit&outputFormat=application/json&srsName=EPSG:4326`;

        const plotsRes = await fetch(plotsUrl);
        if (!plotsRes.ok) throw new Error('Failed to fetch Helsinki business plots');

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

        if (propertyIds.size === 0) return features.map((f: any) => ({ ...f.properties, geometry: f.geometry, datanomistaja: 'Helsinki' }));

        // 3. Fetch Kiinteisto_alue (Polygons)
        // We need to utilize CQL_FILTER or featureID filtering if possible, or just fetch by attribute kiinteistotunnus
        // WFS 2.0 supports 'cql_filter' in Geoserver
        // Construct filter: kiinteistotunnus IN ('id1', 'id2', ...)
        const idList = Array.from(propertyIds).map(id => `'${id}'`).join(',');
        const cqlFilter = `kiinteistotunnus IN (${idList})`;

        const polygonsUrl = `${HELSINKI_WFS_BASE_URL}?service=WFS&version=2.0.0&request=GetFeature&typeName=avoindata:Kiinteisto_alue&outputFormat=application/json&srsName=EPSG:4326&cql_filter=${encodeURIComponent(cqlFilter)}`;

        const polyRes = await fetch(polygonsUrl);
        let polyJson: any;
        if (polyRes.ok) {
            polyJson = await polyRes.json();
        } else {
            console.error('Failed to fetch Helsinki polygons', await polyRes.text());
        }

        // 4. Merge Data
        const mergedPlots: BusinessPlot[] = features.map((f: any) => {
            const props = f.properties;
            const cleanId = props.jhs_tunnus?.replace(/-/g, '') || '';

            // Find matching polygon
            const polygonFeature = polyJson?.features?.find((pf: any) => pf.properties.kiinteistotunnus === cleanId);

            return {
                ...props,
                datanomistaja: 'Helsinki',
                locationGeometry: f.geometry, // Original Point
                geometry: polygonFeature ? polygonFeature.geometry : f.geometry, // Use Polygon if available, else Point
                isPolygon: !!polygonFeature
            };
        });

        return mergedPlots;

    } catch (err) {
        console.error('Error fetching Helsinki business plots:', err);
        return [];
    }
}

async function fetchEspooBusinessPlots(): Promise<BusinessPlot[]> {
    try {
        const url = `${ESPOO_WFS_BASE_URL}?service=WFS&version=1.1.0&request=GetFeature&typeName=GIS:VapaatYritystontit&srsName=EPSG:4326`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch Espoo business plots');

        const xmlText = await res.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");

        const featureMembers = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/gml", "featureMember");
        const plots: BusinessPlot[] = [];

        for (let i = 0; i < featureMembers.length; i++) {
            const feature = featureMembers[i];
            const tonttiElem = feature.getElementsByTagNameNS("http://www.tekla.com/schemas/GIS", "VapaatYritystontit")[0];
            if (!tonttiElem) continue;

            const getValue = (tagName: string) => {
                const el = tonttiElem.getElementsByTagNameNS("http://www.tekla.com/schemas/GIS", tagName)[0];
                return el?.textContent || '';
            };

            const kiinteistotunnus = getValue("KIINTEISTOTUNNUS");
            const pintaAlaRaw = getValue("REKISTERIPINTAALA");
            const pintaAla = pintaAlaRaw ? Math.round(parseFloat(pintaAlaRaw)).toString() : '';
            const tila = getValue("REKISTERITILA");
            const laji = getValue("REKISTERIYKSIKKOLAJI");
            const yritystontti = getValue("YRITYSTONTTI");

            // Extract polygon coordinates
            let polygonGeoJson = null;
            let pointGeoJson = null;

            const posListEls = tonttiElem.getElementsByTagNameNS("http://www.opengis.net/gml", "pos");
            if (posListEls.length > 0) {
                const polygonCoords: [number, number][] = [];
                for (let j = 0; j < posListEls.length; j++) {
                    const posText = posListEls[j].textContent;
                    if (posText) {
                        const [latStr, lonStr] = posText.trim().split(/\s+/);
                        // GML from Espoo seems to be Lat Lon or Lon Lat, need to check. EPSG:4326 usually means lat, lon in GML 1.1? 
                        // Our earlier curl showed: 24.5871315 60.1873284 which is Lon Lat for Finland.
                        const lon = parseFloat(latStr); // Actually lon
                        const lat = parseFloat(lonStr); // Actually lat
                        if (!isNaN(lon) && !isNaN(lat)) {
                            polygonCoords.push([lon, lat]);
                        }
                    }
                }

                if (polygonCoords.length >= 4) {
                    polygonGeoJson = {
                        type: "Polygon",
                        coordinates: [polygonCoords]
                    };

                    // Simple centroid calculation for locationGeometry
                    let sumLon = 0;
                    let sumLat = 0;
                    // Exclude last point (duplicate of first) for true average
                    const pointsCount = polygonCoords.length - 1;
                    for (let j = 0; j < pointsCount; j++) {
                        sumLon += polygonCoords[j][0];
                        sumLat += polygonCoords[j][1];
                    }
                    pointGeoJson = {
                        type: "Point",
                        coordinates: [sumLon / pointsCount, sumLat / pointsCount]
                    };
                }
            }


            plots.push({
                id: `espoo_${kiinteistotunnus || i}`,
                jhs_tunnus: kiinteistotunnus,
                osoite: kiinteistotunnus, // Espoo data doesn't seem to have exact address
                pinta_ala: pintaAla,
                rakennusoikeus: '', // Not provided
                kayttotarkoitusmerkinta: yritystontti || 'Tyhjä',
                kayttotarkoitus_selite: `${laji} (${tila})`,
                lisatietoja: null,
                luokka: '',
                e: '',
                n: '',
                paivitetty_tietopalveluun: '',
                datanomistaja: 'Espoo',
                geometry: polygonGeoJson,
                locationGeometry: pointGeoJson,
                isPolygon: !!polygonGeoJson
            });
        }

        return plots;

    } catch (err) {
        console.error('Error fetching Espoo business plots:', err);
        return [];
    }
}

export async function fetchBusinessPlots(): Promise<BusinessPlot[]> {
    try {
        const [helsinkiPlots, espooPlots] = await Promise.all([
            fetchHelsinkiBusinessPlots(),
            fetchEspooBusinessPlots()
        ]);

        return [...helsinkiPlots, ...espooPlots];
    } catch (err) {
        console.error('Error in fetchBusinessPlots:', err);
        return [];
    }
}
