import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { PreviewShell } from "./preview-shell";

describe("preview shell", () => {
  it("shows all planned sections and explicit non-data states", () => {
    render(<PreviewShell section="overview" />);

    expect(screen.getByRole("navigation", { name: "เมนูหลัก" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "ภาพรวม" })).toHaveAttribute("href", "/preview");
    expect(screen.getByRole("link", { name: "พนักงาน" })).toHaveAttribute("href", "/preview/employees");
    expect(screen.getByRole("link", { name: "วันลา" })).toHaveAttribute("href", "/preview/leave");
    expect(screen.getByRole("link", { name: "ตั้งค่า" })).toHaveAttribute("href", "/preview/settings");
    expect(screen.getAllByText(/ยังไม่มีข้อมูล/).length).toBeGreaterThan(0);
    expect(screen.getByText(/กำลังโหลด/)).toBeTruthy();
    expect(screen.getByText(/ไม่สามารถโหลดข้อมูล/)).toBeTruthy();
    expect(screen.queryByText(/48 คน|312\.5/)).toBeNull();
  });
});
