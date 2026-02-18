import { NextRequest, NextResponse } from 'next/server';
import proj4 from 'proj4';

const MML_API_KEY = process.env.MML_API_KEY;

// Define ETRS-TM35FIN projection (EPSG:3067)
proj4.defs('EPSG:3067', '+proj=utm +zone=35 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs');

export async function GET(request: NextRequest) {
    const { searchParams } = new URL(request.url);
    const bboxParam = searchParams.get('bbox');

    if (!bboxParam) {
        return NextResponse.json({ error: 'bbox parameter is required' }, { status: 400 });
    }

    try {
        // Parse WGS84 bbox: minLng,minLat,maxLng,maxLat
        const [minLng, minLat, maxLng, maxLat] = bboxParam.split(',').map(Number);



        // Convert to EPSG:3067 (ETRS-TM35FIN) - Finland's national projected coordinate system
        const [minX, minY] = proj4('EPSG:4326', 'EPSG:3067', [minLng, minLat]);
        const [maxX, maxY] = proj4('EPSG:4326', 'EPSG:3067', [maxLng, maxLat]);

        const bbox3067 = `${minX},${minY},${maxX},${maxY}`;



        // Build MML API URL with EPSG:3067 coordinates
        // Using PalstanSijaintitiedot (parcel data) which includes kiinteistotunnus
        // Note: bbox is in EPSG:3067, but we request results in EPSG:4326 (WGS84) for Leaflet
        const url = `https://avoin-paikkatieto.maanmittauslaitos.fi/kiinteisto-avoin/simple-features/v3/collections/PalstanSijaintitiedot/items?bbox=${bbox3067}&bbox-crs=http://www.opengis.net/def/crs/EPSG/0/3067&crs=http://www.opengis.net/def/crs/EPSG/0/4326&limit=1000`;



        // Use HTTP Basic Authentication with API key
        const credentials = Buffer.from(`${MML_API_KEY}:`).toString('base64');

        const response = await fetch(url, {
            headers: {
                'Authorization': `Basic ${credentials}`
            }
        });



        if (!response.ok) {
            const errorText = await response.text();
            console.error('PropertyBoundaries API: MML error:', errorText);
            return NextResponse.json(
                { error: 'Failed to fetch property boundaries' },
                { status: response.status }
            );
        }

        const data = await response.json();


        // MML API returns coordinates in [lat, lng] format, but GeoJSON spec requires [lng, lat]
        // We need to swap the coordinates for each feature
        if (data.features) {
            data.features.forEach((feature: any) => {
                if (feature.geometry && feature.geometry.coordinates) {
                    if (feature.geometry.type === 'LineString') {
                        // For LineString, swap each coordinate pair
                        feature.geometry.coordinates = feature.geometry.coordinates.map((coord: number[]) => [coord[1], coord[0]]);
                    } else if (feature.geometry.type === 'Polygon') {
                        // For Polygon, swap each coordinate pair in each ring
                        feature.geometry.coordinates = feature.geometry.coordinates.map((ring: number[][]) =>
                            ring.map((coord: number[]) => [coord[1], coord[0]])
                        );
                    } else if (feature.geometry.type === 'MultiLineString') {
                        // For MultiLineString, swap each coordinate pair in each line
                        feature.geometry.coordinates = feature.geometry.coordinates.map((line: number[][]) =>
                            line.map((coord: number[]) => [coord[1], coord[0]])
                        );
                    } else if (feature.geometry.type === 'MultiPolygon') {
                        // For MultiPolygon, swap each coordinate pair in each ring of each polygon
                        feature.geometry.coordinates = feature.geometry.coordinates.map((polygon: number[][][]) =>
                            polygon.map((ring: number[][]) =>
                                ring.map((coord: number[]) => [coord[1], coord[0]])
                            )
                        );
                    }
                }
            });

        }

        return NextResponse.json(data);
    } catch (error) {
        console.error('PropertyBoundaries API: Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch property boundaries' },
            { status: 500 }
        );
    }
}
