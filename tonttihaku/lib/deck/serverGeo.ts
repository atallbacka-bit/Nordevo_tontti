// Server-side loaders for the static geo datasets the client fetches from
// /data/*.json — the deck route reads them straight off the filesystem.

import { promises as fs } from 'fs';
import path from 'path';
import type { PostalAreaFC, RailStation, Amenity } from '@/lib/marketData';

async function readPublicJson<T>(name: string): Promise<T> {
    const p = path.join(process.cwd(), 'public', 'data', name);
    return JSON.parse(await fs.readFile(p, 'utf8')) as T;
}

export const loadPostalAreasFs = () => readPublicJson<PostalAreaFC>('postal-areas-pks.json');
export const loadRailStationsFs = () => readPublicJson<RailStation[]>('rail-stations.json');
export const loadAmenitiesFs = () => readPublicJson<Amenity[]>('amenities-pks.json');

export async function readBrandAsset(rel: string): Promise<Buffer> {
    return fs.readFile(path.join(process.cwd(), 'public', 'brand', rel));
}
