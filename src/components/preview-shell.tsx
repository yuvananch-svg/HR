import Link from "next/link";
import styles from "./preview-shell.module.css";

export type PreviewSection = "overview" | "employees" | "leave" | "settings";

const sections: { id: PreviewSection; label: string; icon: string; href: string }[] = [
  { id: "overview", label: "ภาพรวม", icon: "◫", href: "/preview" },
  { id: "employees", label: "พนักงาน", icon: "♙", href: "/preview/employees" },
  { id: "leave", label: "วันลา", icon: "▦", href: "/preview/leave" },
  { id: "settings", label: "ตั้งค่า", icon: "⚙", href: "/preview/settings" },
];

const pageContent: Record<PreviewSection, { title: string; description: string; empty: string }> = {
  overview: { title: "ภาพรวม", description: "ภาพรวมข้อมูลสำคัญขององค์กร", empty: "เมื่อเชื่อมต่อฐานข้อมูลแล้ว ภาพรวมพนักงานและวันลาจะแสดงที่นี่" },
  employees: { title: "พนักงาน", description: "ค้นหาและจัดการประวัติพนักงาน", empty: "รายชื่อพนักงานจะแสดงที่นี่หลังเชื่อมต่อฐานข้อมูล" },
  leave: { title: "วันลา", description: "ดูประวัติและจัดการรายการวันลา", empty: "ประวัติวันลาจะแสดงที่นี่หลังเชื่อมต่อฐานข้อมูล" },
  settings: { title: "ตั้งค่า", description: "ประเภทลา โควตา และวันหยุดขององค์กร", empty: "การตั้งค่าจะแสดงที่นี่หลังเชื่อมต่อฐานข้อมูล" },
};

function Brand() {
  return <Link className={styles.brand} href="/" aria-label="HR กลับหน้าเข้าสู่ระบบ"><span className={styles.mark} aria-hidden="true"><i /><i /><i /></span><span><strong>HR</strong><small>People workspace</small></span></Link>;
}

export function PreviewShell({ section }: { section: PreviewSection }) {
  const content = pageContent[section];
  return (
    <div className={styles.app}>
      <aside className={styles.sidebar}>
        <Brand />
        <p className={styles.navLabel}>เมนูหลัก</p>
        <nav className={styles.nav} aria-label="เมนูหลัก">
          {sections.map((item) => <Link key={item.id} href={item.href} aria-current={section === item.id ? "page" : undefined} className={`${styles.navItem} ${section === item.id ? styles.active : ""}`}><span className={styles.navIcon} aria-hidden="true">{item.icon}</span>{item.label}</Link>)}
        </nav>
        <div className={styles.sidebarFoot}><span /> พื้นที่ตัวอย่าง<br />ไม่มีข้อมูลจริง</div>
      </aside>

      <main className={styles.main}>
        <header className={styles.topbar}>
          <div className={styles.mobileHeader}><Brand /><Link href="/" className={styles.backLink}>ออกจากตัวอย่าง <span aria-hidden="true">↗</span></Link></div>
          <div className={styles.breadcrumb}><span>พื้นที่ทำงาน</span><span aria-hidden="true">/</span><strong>{content.title}</strong></div>
          <div className={styles.previewBadge}><span /> ตัวอย่างหน้าจอ · ยังไม่เชื่อมข้อมูล</div>
        </header>

        <section className={styles.content} aria-labelledby="section-title">
          <div className={styles.titleRow}><div><p className={styles.kicker}>HR WORKSPACE</p><h1 id="section-title">{content.title}</h1><p className={styles.description}>{content.description}</p></div><span className={styles.previewStamp}>ตัวอย่าง</span></div>
          <div className={styles.emptyCard}>
            <div className={styles.emptyIcon} aria-hidden="true"><span /></div>
            <h2>ยังไม่มีข้อมูลให้แสดง</h2>
            <p>{content.empty}</p>
            <span className={styles.emptyFoot}>พื้นที่นี้จะเริ่มแสดงข้อมูลหลังตั้งค่าฐานข้อมูลและสิทธิ์ผู้ใช้</span>
          </div>
          <section className={styles.states} aria-labelledby="states-title">
            <div className={styles.statesHeader}><div><h2 id="states-title">ตัวอย่างข้อความสถานะ</h2><p>รูปแบบที่ระบบจะแจ้งเมื่อเชื่อมต่อข้อมูล</p></div><span>ตัวอย่าง UI</span></div>
            <div className={styles.stateGrid}>
              <div className={styles.stateCard}><span className={`${styles.stateDot} ${styles.loadingDot}`} /><div><strong>กำลังโหลดข้อมูล</strong><p>กำลังดึงข้อมูลล่าสุด…</p></div></div>
              <div className={styles.stateCard}><span className={`${styles.stateDot} ${styles.errorDot}`} /><div><strong>ไม่สามารถโหลดข้อมูล</strong><p>ลองใหม่อีกครั้ง หรือติดต่อผู้ดูแลระบบ</p></div></div>
              <div className={styles.stateCard}><span className={`${styles.stateDot} ${styles.emptyDot}`} /><div><strong>ยังไม่มีข้อมูล</strong><p>ข้อมูลจะแสดงเมื่อเริ่มใช้งานระบบ</p></div></div>
            </div>
          </section>
          <p className={styles.safetyNote}>ไม่มีข้อมูลพนักงาน โควตาวันลา หรือวันหยุดในตัวอย่างนี้</p>
        </section>
      </main>
    </div>
  );
}
