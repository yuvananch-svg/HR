import Link from "next/link";
import { EmployeeGeneralForm } from "@/components/employee-general-form";
import styles from "../../workspace.module.css";
export default function NewEmployeePage() {
  return <><p className={styles.kicker}><Link href="/workspace/employees">พนักงาน</Link> / เพิ่มพนักงาน</p><h1>เพิ่มพนักงาน</h1><p className={styles.subtitle}>กรอกข้อมูลทั่วไปเพื่อสร้างทะเบียนพนักงาน</p><section className={styles.panel}><EmployeeGeneralForm /></section></>;
}
