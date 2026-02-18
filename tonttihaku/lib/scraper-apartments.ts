import * as cheerio from 'cheerio';

export interface ApartmentSale {
    id: string;
    company: string;
    address: string;
    price: number;
    size: number; // m2
    pricePerSqm: number;
    lat?: number;
    lng?: number;
}

export async function scrapeApartments(): Promise<ApartmentSale[]> {
    // Example targets - in reality, these would be specific URLs for YIT, Skanska, etc.
    // Since we can't easily scrape complex SPAs (Single Page Apps) with just cheerio without Puppeteer/Playwright,
    // and many construction sites are SPAs, this is a best-effort mock/template.

    const apartments: ApartmentSale[] = [
        {
            id: 'apt-1',
            company: 'Rakennusliike Oy',
            address: 'Esimerkkikatu 10, Helsinki',
            price: 350000,
            size: 55,
            pricePerSqm: 6363,
            lat: 60.17,
            lng: 24.94
        },
        {
            id: 'apt-2',
            company: 'Asunnot Oy',
            address: 'Mallitie 5, Helsinki',
            price: 420000,
            size: 62,
            pricePerSqm: 6774,
            lat: 60.18,
            lng: 24.95
        }
    ];

    return apartments;
}
