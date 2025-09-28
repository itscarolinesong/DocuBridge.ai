import type { Metadata } from "next";
import { Inter } from "next/font/google";
import './globals.css';
import { CedarProvider } from '@/components/CedarProvider';

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "MedReport AI",
  description: "AI-powered medical report generation",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className} suppressHydrationWarning>
        <CedarProvider>
          {children}
        </CedarProvider>
      </body>
    </html>
  );
}
