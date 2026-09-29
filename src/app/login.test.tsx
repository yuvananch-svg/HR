import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoginPage from "./page";

describe("Thai login scaffold", () => {
  it("explains that sign-in is unavailable until authentication is connected", () => {
    render(<LoginPage />);

    expect(screen.getByRole("heading", { name: "เข้าสู่ระบบ" })).toBeTruthy();
    expect(screen.getByText(/ยังไม่พร้อมใช้งาน/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeDisabled();
  });

  it("provides a clearly labeled screen preview without authenticating", () => {
    render(<LoginPage />);

    expect(screen.getByRole("link", { name: /ดูตัวอย่างหน้าจอ/ })).toHaveAttribute(
      "href",
      "/preview",
    );
  });
});
