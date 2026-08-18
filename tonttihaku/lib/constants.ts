// Base Zoning Types — one distinct hue per type so AK/AP/KL/... separate at a glance.
// Status is encoded separately (STATUS_ACCENTS dot); these color the type badge/dots/chips.
// Order: AK -> AP -> KL -> KTY -> T -> Y
export const ZONING_TYPES = [
    { code: 'AK', label: 'Asuinkerrostalo', color: '#1d4ed8' }, // Blue-700
    { code: 'AP', label: 'Asuinpientalo', color: '#0891b2' }, // Cyan-600
    { code: 'KL', label: 'Liikerakennukset', color: '#d97706' }, // Amber-600
    { code: 'KTY', label: 'Toimitilarakennukset', color: '#db2777' }, // Pink-600
    { code: 'T', label: 'Teollisuus', color: '#57534e' }, // Stone-600
    { code: 'Y', label: 'Julkinen', color: '#7c3aed' }, // Violet-600
];

export const getZoningColor = (code: string): string => {
    const zoning = ZONING_TYPES.find(z => z.code === code);
    return zoning?.color || '#6b7280';
};

// Solid accent per status — single source for map markers, filter chips and popup chips
export const STATUS_ACCENTS: Record<string, string> = {
    'Vapaa': '#2563eb',
    'Kilpailussa': '#dc2626',
    'Tarjottu': '#16a34a',
    'Pidossa': '#9333ea',
    'Mennyt': '#9ca3af',
};

export const getStatusAccent = (status: string): string => STATUS_ACCENTS[status] || '#2563eb';

export const STATUS_OPTIONS = [
    { value: 'Vapaa', label: 'Vapaa', color: 'text-blue-600' },
    { value: 'Kilpailussa', label: 'Kilpailussa', color: 'text-red-600' },
    { value: 'Tarjottu', label: 'Tarjottu', color: 'text-green-600' },
    { value: 'Mennyt', label: 'Mennyt', color: 'text-gray-500' },
    { value: 'Pidossa', label: 'Pidossa', color: 'text-purple-600' },
];

// Construction material potential (from Tonttilistaus.xlsx "Wood /Concrete" column)
// '' (empty) on a plot means unknown / not classified
export const MATERIAL_OPTIONS = [
    { value: 'Puu', label: 'Puu' },
    { value: 'Betoni', label: 'Betoni' },
];

export const MML_API_KEY_ENV_VAR = 'MML_API_KEY';

export const KUNTA_OPTIONS = [
    { value: 'Helsinki', label: 'Helsinki' },
    { value: 'Espoo', label: 'Espoo' },
    { value: 'Vantaa', label: 'Vantaa' },
    { value: 'Kauniainen', label: 'Kauniainen' },
];
