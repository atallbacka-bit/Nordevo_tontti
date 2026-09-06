// The map's default "Vaalea" basemap (CARTO light_all) needs an API key, and
// NEXT_PUBLIC_* values are inlined at build time — so the key must exist in the
// *build* environment (Vercel → Settings → Environment Variables, Production),
// not just in .env.local. Adding it on Vercel after a deploy does nothing until
// the next build. Make a missing key impossible to miss in the build log.
if (process.env.NODE_ENV === 'production' && !process.env.NEXT_PUBLIC_CARTO_API_KEY) {
    console.warn(
        '\n⚠  NEXT_PUBLIC_CARTO_API_KEY is not set in this build environment.\n' +
        '   The "Vaalea" basemap will be disabled (CARTO serves "API KEY REQUIRED" tiles without it).\n' +
        '   On Vercel: Settings → Environment Variables → add it for Production, then redeploy.\n'
    );
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    reactStrictMode: false, // Leaflet sometimes has issues with strict mode in dev
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    {
                        key: 'X-DNS-Prefetch-Control',
                        value: 'on'
                    },
                    {
                        key: 'Strict-Transport-Security',
                        value: 'max-age=63072000; includeSubDomains; preload'
                    },
                    {
                        key: 'X-XSS-Protection',
                        value: '1; mode=block'
                    },
                    {
                        key: 'X-Frame-Options',
                        value: 'SAMEORIGIN'
                    },
                    {
                        key: 'X-Content-Type-Options',
                        value: 'nosniff'
                    },
                    {
                        key: 'Referrer-Policy',
                        value: 'origin-when-cross-origin'
                    }
                ]
            }
        ];
    },
};

module.exports = nextConfig;
