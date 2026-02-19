const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Configuration
const FILE_PATH = process.env.FILE_PATH || 'NEW_appartment_data_10_2025.xlsx';
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('Error: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in environment variables.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function processFile() {
    console.log(`Reading file: ${FILE_PATH}`);
    const wb = XLSX.readFile(FILE_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Header is on 4th row (index 3)
    const data = XLSX.utils.sheet_to_json(ws, { range: 3 });
    console.log(`Total rows found: ${data.length}`);

    const validRows = data.filter(row => row['OSOITE'] || row['Osoite']);
    console.log(`Valid rows with address: ${validRows.length}`);

    let processedItems = [];
    const CACHE_FILE = 'processed_sales_data.json';

    if (fs.existsSync(CACHE_FILE)) {
        console.log(`Loading cached data from ${CACHE_FILE}...`);
        processedItems = JSON.parse(fs.readFileSync(CACHE_FILE));
    } else {
        console.log('Starting geocoding (this will take a few minutes due to rate limits)...');

        for (let i = 0; i < validRows.length; i++) {
            const row = validRows[i];
            const address = row['OSOITE'] || row['Osoite'];
            const city = row['KAUPUNKI'] || row['Kaupunki'] || 'Helsinki';
            const searchAddress = `${address}, ${city}`;
            const addressKey = `${address}_${city}`.toLowerCase();

            process.stdout.write(`Processing ${i + 1}/${validRows.length}: ${searchAddress}`);

            try {
                // Rate limit delay (1.2s)
                await new Promise(r => setTimeout(r, 1200));

                const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchAddress)}&limit=1`, {
                    headers: {
                        'User-Agent': 'Tonttihaku-Analysis/1.0'
                    }
                });

                if (!res.ok) throw new Error(`HTTP ${res.status}`);

                const geoRes = await res.json();

                if (geoRes && geoRes.length > 0) {
                    const lat = parseFloat(geoRes[0].lat);
                    const lng = parseFloat(geoRes[0].lon);

                    processedItems.push({
                        data: row,
                        lat,
                        lng,
                        address_key: addressKey
                    });
                    process.stdout.write(` -> OK (${lat.toFixed(4)}, ${lng.toFixed(4)})\n`);
                } else {
                    process.stdout.write(` -> NOT FOUND\n`);
                    console.warn(`Could not geocode: ${searchAddress}`);
                }

            } catch (err) {
                process.stdout.write(` -> ERROR: ${err.message}\n`);
            }
        }

        // Save to cache
        fs.writeFileSync(CACHE_FILE, JSON.stringify(processedItems, null, 2));
        console.log(`Geocoding complete. Saved ${processedItems.length} items to ${CACHE_FILE}`);
    }

    if (processedItems.length > 0) {
        console.log('Clearing old data from database...');
        const deleteRes = await supabase.from('sales_analysis_data').delete().neq('id', '00000000-0000-0000-0000-000000000000');
        if (deleteRes.error) {
            console.error('Error clearing data:', deleteRes.error);
            return;
        }

        console.log('Inserting new data...');
        const insertRes = await supabase.from('sales_analysis_data').insert(processedItems);

        if (insertRes.error) {
            console.error('Error inserting data:', insertRes.error);
        } else {
            console.log('SUCCESS! Data saved to database.');
        }
    } else {
        console.log('No valid data to save.');
    }
}

processFile().catch(console.error);
