import Link from "next/link";
import { Suspense } from "react";
import { AuthNotice } from "@/components/auth-notice";
import { LoginForm } from "@/components/login-form";
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

          <Suspense fallback={null}><AuthNotice /></Suspense>
          <LoginForm />

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
