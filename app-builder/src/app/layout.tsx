import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "App Builder",
  description: "Chat to build a web app — running on OpenComputer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
