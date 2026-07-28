import type { Metadata, Viewport } from "next";
import { Archivo, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { ConfirmProvider } from "@/components/confirm-dialog";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { RealtimeRefresher } from "@/components/realtime-refresher";
import { SessionGuard } from "@/components/session-guard";
import { ScrollContainer } from "@/components/scroll-container";
import { BottomNav } from "@/components/kok/bottom-nav";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker";
import { ThemeColorSync } from "@/components/pwa/theme-color-sync";
import { ViewportGuard } from "@/components/pwa/viewport-guard";
import { getData } from "@/lib/data";

const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"], weight: ["600", "700", "800"] });
const hanken = Hanken_Grotesk({ variable: "--font-hanken", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-jbmono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Kok Badminton",
  description: "Kas patungan kok badminton — matchup, tagihan, dan setelan, realtime.",
  applicationName: "Kok Badminton",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "Kok Badminton",
    statusBarStyle: "default",
  },
  // iOS gemar bikin angka (nominal Rp, tanggal) jadi link telepon/kalender
  formatDetection: { telephone: false, date: false, address: false, email: false },
  other: {
    // `appleWebApp.capable` di Next 16 cuma nulis `mobile-web-app-capable`, yang
    // baru dimengerti Safari 17.4+. iOS di bawah itu butuh nama lamanya, kalau
    // gak app dari home screen kebuka dengan chrome Safari — bukan standalone.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0a1120" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const data = await getData();
  const canRecord = data.me.role === "admin" || data.me.role === "operator";

  return (
    <html
      lang="id"
      className={`${archivo.variable} ${hanken.variable} ${mono.variable}`}
      suppressHydrationWarning
    >
      <body className="h-svh overflow-hidden font-sans antialiased">
        <ThemeProvider>
          <ConfirmProvider>
            <SessionGuard role={data.me.role}>
              <ScrollContainer>{children}</ScrollContainer>
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
            </SessionGuard>
            <Toaster position="top-center" richColors />
            <RealtimeRefresher />
            <ThemeColorSync />
            <ViewportGuard />
            <ServiceWorkerRegister />
          </ConfirmProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
