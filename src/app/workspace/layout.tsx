import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { SignOut } from "@/components/sign-out";
import styles from "./workspace.module.css";
export const dynamic = "force-dynamic";
export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const { user, member } = await requireStaff();
  return <div className={styles.app}>
    <aside className={styles.sidebar}><Link href="/workspace" className={styles.brand}>HR <small>People workspace</small></Link>
      <nav aria-label="เมนูหลัก"><Link href="/workspace">ภาพรวม</Link><Link href="/workspace/employees">พนักงาน</Link>
        <Link href="/workspace/leave">วันลา</Link><Link href="/workspace/settings">ตั้งค่า</Link></nav>
      <div className={styles.account}><strong>{member.role === "owner" ? "เจ้าของ" : "ฝ่าย HR"}</strong><p>{user.email}</p><SignOut /></div>
    </aside><main className={styles.main}>{children}</main>
  </div>;
}
