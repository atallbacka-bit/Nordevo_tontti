const XLSX = require('xlsx');

const FILE_PATH = 'NEW_appartment_data_10_2025.xlsx';

try {
    const wb = XLSX.readFile(FILE_PATH);
    const ws = wb.Sheets[wb.SheetNames[0]];

    // Read with header: "A" to see column letters mapping to values
    const dataWithLetters = XLSX.utils.sheet_to_json(ws, { header: "A", range: 0, limit: 5 });

    // Read with default basic headers (row 4 usually based on previous context)
    // The previous script used range: 3 (row 4). Let's check rows 0-5 to be sure where headers are.
    const rawRows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, limit: 5 });

    console.log("--- RAW ROWS (First 5) ---");
    rawRows.forEach((row, i) => {
        console.log(`Row ${i}:`, JSON.stringify(row));
    });

    console.log("\n--- COLUMN MAPPING INFERENCE ---");
    // User said:
    // O: Mean sale price per sqm
    // L: Total size
    // K: Total units
    // S: Sold units
    // N: Keskipinta-ala
    // P: Hinnan peitto

    // Let's print the values in these columns for the 4th row (index 3) which is likely the header
    // Or if the header is index 3, we look at index 3.

    if (rawRows.length > 3) {
        const headerRow = rawRows[3]; // Assuming row 4 is header
        console.log(`Header Candidate (Row 4):`);
        console.log(`Col K (Index 10): ${headerRow[10]}`);
        console.log(`Col L (Index 11): ${headerRow[11]}`);
        console.log(`Col N (Index 13): ${headerRow[13]}`);
        console.log(`Col O (Index 14): ${headerRow[14]}`);
        console.log(`Col P (Index 15): ${headerRow[15]}`);
        console.log(`Col S (Index 18): ${headerRow[18]}`);

        console.log(`Col Y (Index 24): ${headerRow[24]}`);
        console.log(`Col AI (Index 34): ${headerRow[34]}`);

        console.log(`Col Z (Index 25): ${headerRow[25]}`);
        console.log(`Col AJ (Index 35): ${headerRow[35]}`);
    }

} catch (e) {
    console.error(e);
}
