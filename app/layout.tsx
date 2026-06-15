import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Serwis",
  description: "Interaktywny podglad modelu 3D przed i po naprawie.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
