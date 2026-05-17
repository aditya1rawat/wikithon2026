import type { Metadata } from "next";
import Link from "next/link";
import { Network, Search, UploadCloud } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: "ConsensusWiki",
  description: "A live wiki for contested facts and source-backed disagreement.",
};

const nav = [
  { href: "/", label: "Dashboard" },
  { href: "/ingest", label: "Ingest", icon: UploadCloud },
  { href: "/graph", label: "Graph", icon: Network },
  { href: "/query", label: "Query", icon: Search },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
          <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                <Network className="h-4 w-4" />
              </span>
              ConsensusWiki
            </Link>
            <nav className="flex items-center gap-1">
              {nav.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="focus-ring inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {Icon ? <Icon className="h-4 w-4" /> : null}
                    <span className="hidden sm:inline">{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </body>
    </html>
  );
}
