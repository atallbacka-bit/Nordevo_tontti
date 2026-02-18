import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

import AuthProvider from "@/components/AuthProvider";

export const metadata: Metadata = {
    title: "Pääkaupunkiseutu Tonttihaku",
    description: "Etsi ja analysoi tontteja pääkaupunkiseudulla",
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="fi">
            <body className={inter.className}>
                <AuthProvider>{children}</AuthProvider>
            </body>
        </html>
    );
}
