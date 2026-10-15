import { ClerkProvider } from "@clerk/nextjs";
import { auth } from "@clerk/nextjs/server";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GraphIt",
  description: "Clerk-backed workspace shell",
};

export const instant = false;

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const { orgSlug } = await auth();
  const themeCookie = (await cookies()).get("theme")?.value;
  const theme = themeCookie === "light" || themeCookie === "dark" ? themeCookie : "system";

  return (
    <html
      lang="en"
      data-theme={theme}
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <ClerkProvider>
          <AppShell currentOrgSlug={orgSlug ?? null} theme={theme}>
            {children}
          </AppShell>
        </ClerkProvider>
      </body>
    </html>
  );
}