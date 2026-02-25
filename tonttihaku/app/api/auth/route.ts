import { NextResponse } from 'next/server';
import crypto from 'crypto';

export async function POST(req: Request) {
    try {
        const { password } = await req.json();
        const sitePassword = process.env.SITE_PASSWORD;

        if (!sitePassword) {
            console.error('SITE_PASSWORD env var not set');
            return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }

        if (password === sitePassword) {
            // Create HMAC-signed token (prevents token forgery)
            const payload = `tonttihaku:${Date.now()}`;
            const signature = crypto
                .createHmac('sha256', sitePassword)
                .update(payload)
                .digest('hex');
            const token = Buffer.from(`${payload}:${signature}`).toString('base64');
            return NextResponse.json({ success: true, token });
        }

        return NextResponse.json({ error: 'Väärä salasana' }, { status: 401 });
    } catch (error) {
        console.error('Auth error:', error);
        return NextResponse.json({ error: 'Authentication failed' }, { status: 500 });
    }
}

