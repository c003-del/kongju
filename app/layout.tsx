import type { Metadata } from "next";
import localFont from "next/font/local";
import type { CSSProperties, ReactNode } from "react";
import "./globals.css";

const archivo = localFont({
  src: "../public/fonts/ArchivoVariable.woff2",
  display: "swap",
  weight: "100 900",
});

const pretendard = localFont({
  src: "../public/fonts/PretendardVariable.woff2",
  display: "swap",
  weight: "100 900",
});

const configuredSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

export const metadata: Metadata = {
  metadataBase: configuredSiteUrl ? new URL(configuredSiteUrl) : undefined,
  title: "Kongjuworld | Family Photo",
  description: "초대된 가족만 함께 사용하는 비공개 사진 아카이브",
  applicationName: "Kongjuworld",
  alternates: configuredSiteUrl ? { canonical: "/" } : undefined,
  robots: { index: false, follow: false },
};

const fontStyle = {
  "--font-heading": `${archivo.style.fontFamily}, system-ui, sans-serif`,
  "--font-body": `${archivo.style.fontFamily}, ${pretendard.style.fontFamily}, system-ui, sans-serif`,
} as CSSProperties;

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" style={fontStyle}>
      <body>{children}</body>
    </html>
  );
}
