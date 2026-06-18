import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Terminal",
  description: "A shareable, resumable agent run on OpenComputer",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
