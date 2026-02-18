import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { password } = await req.json();
        const sitePassword = process.env.SITE_PASSWORD;

        if (!sitePassword) {
            console.error('SITE_PASSWORD env var not set');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        if (password === sitePassword) {
            // Create a simple session token (hash of password + a secret)
            const token = Buffer.from(`tonttihaku:${sitePassword}:${Date.now()}`).toString('base64');
            return NextResponse.json({ success: true, token });
        }

        return NextResponse.json({ error: 'Väärä salasana' }, { status: 401 });
    } catch (error) {
        console.error('Auth error:', error);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}
