'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
    const router = useRouter();
    useEffect(() => {
        router.push('/');
    }, [router]);

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100">
            <div className="text-gray-500">Ohjataan etusivulle...</div>
        </div>
    );
}
