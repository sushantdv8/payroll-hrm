import type { Metadata } from "next";
import "./globals.css";
import "./payroll.css";
import "./payroll-details.css";

export const metadata: Metadata = {
  title: "Payroll Workspace",
  description: "Employee records, manual attendance, holidays and muster reports.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
