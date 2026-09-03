'use client';

import dynamic from 'next/dynamic';
import { useT } from '@/lib/i18n';

// Dynamically import the Map component to avoid SSR issues with Leaflet
const MapWithNoSSR = dynamic(() => import('@/components/MapComponent'), {
    ssr: false,
    loading: () => <MapLoading />
});

function MapLoading() {
    const t = useT();
    return (
        <div className="flex items-center justify-center h-full bg-gray-200">{t('Ladataan karttaa...')}</div>
    );
}

export default function Home() {
    return (
        <main className="flex h-screen flex-col items-center justify-between">
            <MapWithNoSSR />
        </main>
    );
}
