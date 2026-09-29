import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HR | ระบบข้อมูลพนักงานและวันลา",
  description: "พื้นที่ทำงานสำหรับเจ้าของธุรกิจและฝ่ายบุคคล",
};

export const viewport: Viewport = {
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
