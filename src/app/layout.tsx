import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "HR | ระบบข้อมูลพนักงานและวันลา",
  description: "พื้นที่ทำงานสำหรับเจ้าของธุรกิจและฝ่ายบุคคล",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
