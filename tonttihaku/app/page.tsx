import dynamic from 'next/dynamic';

// Dynamically import the Map component to avoid SSR issues with Leaflet
const MapWithNoSSR = dynamic(() => import('@/components/MapComponent'), {
    ssr: false,
    loading: () => <div className="flex items-center justify-center h-full bg-gray-200">Ladataan karttaa...</div>
});

export default function Home() {
    return (
        <main className="flex h-screen flex-col items-center justify-between">
            <MapWithNoSSR />
        </main>
    );
}
