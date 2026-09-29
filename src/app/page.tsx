import Link from "next/link";
import styles from "./login.module.css";

export default function LoginPage() {
  return (
    <main className={styles.page}>
      <section className={styles.story} aria-label="ระบบข้อมูลบุคลากร">
        <Link className={styles.brand} href="/" aria-label="HR กลับหน้าเข้าสู่ระบบ">
          <span className={styles.brandMark} aria-hidden="true"><i /><i /><i /></span>
          <span><strong>HR</strong><small>People workspace</small></span>
        </Link>
        <div className={styles.storyCopy}>
          <span className={styles.eyebrow}>พื้นที่ทำงานสำหรับ HR</span>
          <h1>ดูแลข้อมูลคน<br />ให้เป็นระบบ</h1>
          <p>รวมข้อมูลพนักงานและประวัติวันลาไว้ในที่เดียว<br className={styles.desktopBreak} /> พร้อมตรวจสอบย้อนหลังได้</p>
          <div className={styles.storyFoot}><span /> ระบบภายในสำหรับเจ้าของธุรกิจและฝ่ายบุคคล</div>
        </div>
        <div className={styles.orbit} aria-hidden="true"><span /><span /><span /></div>
      </section>

      <section className={styles.signIn} aria-labelledby="login-title">
        <div className={styles.signInInner}>
          <div className={styles.mobileBrand} aria-hidden="true">
            <span className={styles.brandMark}><i /><i /><i /></span><strong>HR</strong>
          </div>
          <div className={styles.heading}>
            <span className={styles.eyebrow}>ยินดีต้อนรับ</span>
            <h2 id="login-title">เข้าสู่ระบบ</h2>
            <p>ลงชื่อเข้าใช้เพื่อจัดการข้อมูลบุคลากร</p>
          </div>

          <div className={styles.notice} role="status">
            <span className={styles.noticeIcon} aria-hidden="true">i</span>
            <p><strong>ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน</strong><br />หน้านี้เป็นโครงหน้าจอ การเข้าสู่ระบบจะเปิดใช้หลังเชื่อมต่อ Supabase Auth</p>
          </div>

          <form className={styles.form} aria-label="แบบฟอร์มเข้าสู่ระบบ">
            <label htmlFor="email">อีเมล</label>
            <input id="email" type="email" autoComplete="username" placeholder="name@company.com" disabled />
            <label htmlFor="password">รหัสผ่าน</label>
            <input id="password" type="password" autoComplete="current-password" placeholder="กรอกรหัสผ่าน" disabled />
            <button type="button" disabled>เข้าสู่ระบบ</button>
            <span className={styles.disabledHint}>ช่องกรอกและปุ่มจะเปิดใช้งานเมื่อเชื่อมต่อระบบจริง</span>
          </form>

          <div className={styles.previewBox}>
            <div><strong>กำลังเตรียมพื้นที่ทำงาน</strong><p>ดูตัวอย่างโครงหน้าได้โดยไม่มีข้อมูลจริง</p></div>
            <Link href="/preview" className={styles.previewLink}>ดูตัวอย่างหน้าจอ <span aria-hidden="true">→</span></Link>
          </div>
          <p className={styles.privacy}>ข้อมูลบุคลากรจะเข้าถึงได้หลังยืนยันสิทธิ์ผู้ใช้เท่านั้น</p>
        </div>
        <footer className={styles.footer}>HR workspace <span>·</span> Internal use</footer>
      </section>
    </main>
  );
}
