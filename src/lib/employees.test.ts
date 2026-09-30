import { describe, expect, it } from "vitest";
import { normalizeRelatedRows, safePage, safePageSize, validateEmployeeForm } from "./employees";

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

describe("employee input validation", () => {
  it("trims required and optional text while preserving optional blanks as null", () => {
    const result = validateEmployeeForm(form({ employee_code: " A-1 ", first_name: " Ada ", last_name: " Lovelace ", start_date: "2020-01-01", department: "  " }));
    expect(result.errors).toEqual({});
    expect(result.data).toMatchObject({ employee_code: "A-1", first_name: "Ada", last_name: "Lovelace", department: null, status: "active", termination_date: null });
  });
  it("rejects missing fields, impossible dates, inconsistent termination and invalid status", () => {
    expect(validateEmployeeForm(form({})).errors).toMatchObject({ employee_code: expect.any(Array), first_name: expect.any(Array), last_name: expect.any(Array), start_date: expect.any(Array) });
    expect(validateEmployeeForm(form({ employee_code: "E", first_name: "A", last_name: "B", start_date: "2025-02-30" })).errors.start_date).toBeTruthy();
    expect(validateEmployeeForm(form({ employee_code: "E", first_name: "A", last_name: "B", start_date: "2025-01-02", status: "terminated", termination_date: "2025-01-01" })).errors.termination_date).toBeTruthy();
    expect(validateEmployeeForm(form({ employee_code: "E", first_name: "A", last_name: "B", start_date: "2025-01-02", status: "active", termination_date: "2025-01-03" })).errors.termination_date).toBeTruthy();
    expect(validateEmployeeForm(form({ employee_code: "E", first_name: "A", last_name: "B", start_date: "2025-01-02", status: "on-leave" })).errors.status).toBeTruthy();
  });
  it("clamps untrusted pagination and limits page size", () => {
    expect(safePage(-4)).toBe(1); expect(safePage(2_000_000)).toBe(1_000_000);
    expect(safePageSize(5000)).toBe(100); expect(safePageSize(Number.NaN)).toBe(25);
  });
  it("normalizes PostgREST to-one and to-many relation fixture shapes", () => {
    const related = { employee_id: "e1", leave_type_id: "annual", status: "recorded" };
    expect(normalizeRelatedRows(related)).toEqual([related]);
    expect(normalizeRelatedRows([related])).toEqual([related]);
    expect(normalizeRelatedRows(null)).toEqual([]);
  });
});
