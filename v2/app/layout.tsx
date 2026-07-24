import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { BottomNav } from "@/components/kok/bottom-nav";
import { getData } from "@/lib/data";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["600", "700", "800"] });
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kok Badminton",
  description: "Kas patungan kok badminton — matchup, tagihan, dan setelan, realtime.",
};

export const viewport: Viewport = {
  themeColor: "#eef2f8",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const data = await getData();
  const canRecord = data.me.role === "admin" || data.me.role === "operator";

  return (
    <html lang="id" className={`${archivo.variable} ${hanken.variable} ${mono.variable} h-full`}>
      <body className="min-h-full font-sans antialiased">
        <ConfirmProvider>
          {children}
          <BottomNav
            role={data.me.role}
            recordGame={
              canRecord
                ? {
                    kokTypes: data.kokTypes,
                    players: data.players,
                    defaultPrice: data.settings.defaultPricePerPerson,
                  }
                : undefined
            }
          />
          <Toaster position="top-center" richColors />
          <RealtimeRefresher />
        </ConfirmProvider>
      </body>
    </html>
  );
}
