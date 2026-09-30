import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RevealSensitive } from "./reveal-sensitive";
import { EmployeeGeneralForm } from "./employee-general-form";
import { EmployeeSubmit } from "./employee-submit";
import { RelatedForm } from "./employee-related";
import { saveEmergencyContactAction, updateEmployeeAction } from "@/app/workspace/employees/actions";
import type { EmployeeRow } from "@/lib/employees";

vi.mock("@/app/workspace/employees/actions", () => ({
  createEmployeeAction: vi.fn(), updateEmployeeAction: vi.fn(async (_state:unknown, formData:FormData) => ({message:"บันทึกข้อมูลแล้ว",errors:{},success:true,id:String(formData.get("id"))})),
  saveDocumentAction: vi.fn(async () => ({message:"บันทึกข้อมูลแล้ว",errors:{},success:true,id:"doc-1"})),
  saveBankAccountAction: vi.fn(async () => ({message:"บันทึกข้อมูลแล้ว",errors:{},success:true,id:"bank-1"})),
  saveEmergencyContactAction: vi.fn(async () => ({message:"บันทึกข้อมูลแล้ว",errors:{},success:true,id:"contact-1"})),
  revealSensitiveAction: vi.fn(async () => ({success:true,value:"001234567890",message:""})),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

describe("employee UI", () => {
  const employee:EmployeeRow = {id:"employee-1",employee_code:"E-001",first_name:"Ada",last_name:"Lovelace",start_date:"2024-01-01",address:null,position:null,department:null,phone:null,status:"active",termination_date:null,created_at:"2024-01-01T00:00:00Z",updated_at:"revision-1"};
  it("keeps sensitive numbers hidden until the reveal control is activated", async () => {
    render(<RevealSensitive employeeId="employee-1" section="bank" rowId="bank-1" revision="r1" label="เลขบัญชี" />);
    expect(screen.queryByText("001234567890")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "เปิดเผยเลขบัญชี" }));
    expect(await screen.findByText("001234567890")).toBeInTheDocument();
  });

  it("labels the required general employee fields", () => {
    render(<EmployeeGeneralForm />);
    expect(screen.getByLabelText(/รหัสพนักงาน/)).toBeRequired();
    expect(screen.getByLabelText(/ชื่อ\s*\*/)).toBeRequired();
    expect(screen.getByLabelText(/วันเริ่มงาน/)).toBeRequired();
    expect(screen.getByRole("button", { name: "บันทึกข้อมูลทั่วไป" })).toBeEnabled();
  });

  it("disables form submission while a save is pending", () => {
    render(<EmployeeSubmit pending>บันทึกข้อมูลทั่วไป</EmployeeSubmit>);
    expect(screen.getByRole("button", { name: "กำลังบันทึก…" })).toBeDisabled();
  });

  it("allows a second related-record save after the refreshed revision remounts its form", async () => {
    const view = render(<RelatedForm key="empty" kind="contact" employeeId="employee-1" employeeUpdatedAt="employee-r1" />);
    fireEvent.click(screen.getByRole("button", {name:"เพิ่มผู้ติดต่อ"}));
    fireEvent.change(screen.getByLabelText("ชื่อผู้ติดต่อ"), {target:{value:"First Contact"}});
    fireEvent.change(screen.getByLabelText("เบอร์โทร"), {target:{value:"0812345678"}});
    fireEvent.submit(screen.getByRole("button", {name:"บันทึก"}).closest("form")!);
    expect(await screen.findByText("บันทึกแล้ว")).toBeInTheDocument();
    view.rerender(<RelatedForm key="contact-1:r2" kind="contact" employeeId="employee-1" employeeUpdatedAt="employee-r2" />);
    fireEvent.click(screen.getByRole("button", {name:"เพิ่มผู้ติดต่อ"}));
    expect(screen.getByLabelText("ชื่อผู้ติดต่อ")).toHaveValue("");
    fireEvent.change(screen.getByLabelText("ชื่อผู้ติดต่อ"), {target:{value:"Second Contact"}});
    fireEvent.change(screen.getByLabelText("เบอร์โทร"), {target:{value:"0898765432"}});
    fireEvent.submit(screen.getByRole("button", {name:"บันทึก"}).closest("form")!);
    expect(await screen.findByText("บันทึกแล้ว")).toBeInTheDocument();
    expect(saveEmergencyContactAction).toHaveBeenCalledTimes(2);
  });

  it("allows a second general edit after the employee revision changes", async () => {
    const view = render(<EmployeeGeneralForm key={employee.updated_at} employee={employee} />);
    fireEvent.submit(screen.getByRole("button", {name:"บันทึกข้อมูลทั่วไป"}).closest("form")!);
    expect(await screen.findByText("บันทึกข้อมูลแล้ว")).toBeInTheDocument();
    const nextEmployee = {...employee,updated_at:"revision-2"};
    view.rerender(<EmployeeGeneralForm key={nextEmployee.updated_at} employee={nextEmployee} />);
    fireEvent.submit(screen.getByRole("button", {name:"บันทึกข้อมูลทั่วไป"}).closest("form")!);
    expect(await screen.findByText("บันทึกข้อมูลแล้ว")).toBeInTheDocument();
    expect(updateEmployeeAction).toHaveBeenCalledTimes(2);
  });

  it("shows a refresh action when a general edit reports a revision conflict", async () => {
    vi.mocked(updateEmployeeAction).mockResolvedValueOnce({message:"ข้อมูลถูกแก้ไขโดยผู้ใช้อื่นแล้ว กรุณาโหลดข้อมูลใหม่",errors:{},success:false});
    render(<EmployeeGeneralForm employee={employee} />);
    fireEvent.submit(screen.getByRole("button", {name:"บันทึกข้อมูลทั่วไป"}).closest("form")!);
    expect(await screen.findByRole("button", {name:"โหลดข้อมูลล่าสุด"})).toBeInTheDocument();
  });
});
