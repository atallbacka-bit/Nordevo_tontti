// Base Zoning Types with Default (Vapaa) Colors (Blue Gradient: Dark -> Light)
// Order: AK -> AP -> KL -> KTY -> T -> Y
export const ZONING_TYPES = [
    { code: 'AK', label: 'Asuinkerrostalo', color: '#1e3a8a' }, // Blue-900
    { code: 'AP', label: 'Asuinpientalo', color: '#1e40af' }, // Blue-800
    { code: 'KL', label: 'Liikerakennukset', color: '#1d4ed8' }, // Blue-700
    { code: 'KTY', label: 'Toimitilarakennukset', color: '#2563eb' }, // Blue-600
    { code: 'T', label: 'Teollisuus', color: '#3b82f6' }, // Blue-500
    { code: 'Y', label: 'Julkinen', color: '#60a5fa' }, // Blue-400
];

// Color Palettes for other statuses
const STATUS_COLORS: Record<string, Record<string, string>> = {
    'Kilpailussa': { // Red Gradient
        'AK': '#7f1d1d', // Red-900
        'AP': '#991b1b', // Red-800
        'KL': '#b91c1c', // Red-700
        'KTY': '#dc2626', // Red-600
        'T': '#ef4444', // Red-500
        'Y': '#f87171', // Red-400
    },
    'Tarjottu': { // Green Gradient
        'AK': '#14532d', // Green-900
        'AP': '#166534', // Green-800
        'KL': '#15803d', // Green-700
        'KTY': '#16a34a', // Green-600
        'T': '#22c55e', // Green-500
        'Y': '#4ade80', // Green-400
    },
    'Mennyt': { // Grey Gradient (Lighter)
        'AK': '#4b5563', // Gray-600
        'AP': '#52525b', // Zinc-600
        'KL': '#6b7280', // Gray-500
        'KTY': '#71717a', // Zinc-500
        'T': '#9ca3af', // Gray-400
        'Y': '#a1a1aa', // Zinc-400
    },
    'Pidossa': { // Purple Gradient
        'AK': '#581c87', // Purple-900
        'AP': '#6b21a8', // Purple-800
        'KL': '#7e22ce', // Purple-700
        'KTY': '#9333ea', // Purple-600
        'T': '#a855f7', // Purple-500
        'Y': '#c084fc', // Purple-400
    }
};

export const getZoningColor = (code: string): string => {
    const zoning = ZONING_TYPES.find(z => z.code === code);
    return zoning?.color || '#6b7280';
};

export const getPlotColor = (status: string, zoningCode: string): string => {
    // 1. Check if specific status palette exists
    if (STATUS_COLORS[status] && STATUS_COLORS[status][zoningCode]) {
        return STATUS_COLORS[status][zoningCode];
    }

    // 2. Default to Vapaa (Blue gradient) or generic fallback
    return getZoningColor(zoningCode);
};

export const STATUS_OPTIONS = [
    { value: 'Vapaa', label: 'Vapaa', color: 'text-blue-600' },
    { value: 'Kilpailussa', label: 'Kilpailussa', color: 'text-red-600' },
    { value: 'Tarjottu', label: 'Tarjottu', color: 'text-green-600' },
    { value: 'Mennyt', label: 'Mennyt', color: 'text-gray-500' },
    { value: 'Pidossa', label: 'Pidossa', color: 'text-purple-600' },
];

export const MML_API_KEY_ENV_VAR = 'MML_API_KEY';

export const KUNTA_OPTIONS = [
    { value: 'Helsinki', label: 'Helsinki' },
    { value: 'Espoo', label: 'Espoo' },
    { value: 'Vantaa', label: 'Vantaa' },
    { value: 'Kauniainen', label: 'Kauniainen' },
];
