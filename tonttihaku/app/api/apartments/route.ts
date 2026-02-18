import { NextResponse } from 'next/server';
import { scrapeApartments } from '@/lib/scraper-apartments';

let cachedApartments: any[] = [];

export async function GET() {
    if (cachedApartments.length === 0) {
        cachedApartments = await scrapeApartments();
    }
    return NextResponse.json(cachedApartments);
}
