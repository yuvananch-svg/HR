"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <section role="alert"><h1>ไม่สามารถโหลดข้อมูลได้</h1><p>ตรวจการเชื่อมต่อแล้วลองใหม่</p><button onClick={reset}>ลองใหม่</button></section>;
}
