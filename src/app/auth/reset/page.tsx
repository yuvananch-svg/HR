import { requireStaff } from "@/lib/auth";
import { ResetPasswordForm } from "@/components/reset-password-form";
import styles from "../../login.module.css";
export default async function ResetPassword() {
  await requireStaff();
  return <main className={styles.signIn}><div className={styles.signInInner}><h1>ตั้งรหัสผ่านใหม่</h1><ResetPasswordForm /></div></main>;
}
