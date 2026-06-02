import type { Metadata } from "next";
import "./globals.css";
import { RefreshProvider } from "@/contexts/RefreshContext";

export const metadata: Metadata = {
  title: "TFA Dashboard",
  description: "Marketing analytics across Airtable, Mailchimp, and Google Analytics",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <RefreshProvider>{children}</RefreshProvider>
      </body>
    </html>
  );
}
