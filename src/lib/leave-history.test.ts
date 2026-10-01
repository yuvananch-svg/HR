import { describe, expect, it } from "vitest";
import { employeeSearchFilter, historyPageHref, historyRange, parseCalendarYear, parseHistoryFilters, safeHistoryReturnTo } from "./leave-history";
const employeeId = "11111111-1111-4111-8111-111111111111";
const typeId = "22222222-2222-4222-8222-222222222222";
describe("leave history filters", () => {
  it("validates URL filters and intersects year with date range", () => {
    const parsed = parseHistoryFilters({ employee_id: employeeId, leave_type_id: typeId, status: "cancelled", year: "2026", start_date: "2026-12-20", end_date: "2027-01-10", page: "3" });
    expect(parsed.errors).toEqual([]);
    expect(historyRange(parsed.filters!)).toEqual({ start: "2026-12-20", end: "2026-12-31" });
    expect(historyPageHref(parsed.filters!, 4)).toContain("employee_id=" + employeeId);
    expect(historyPageHref(parsed.filters!, 4)).toContain("page=4");
  });
  it("rejects malformed, reversed, repeated and excessive page values", () => {
    expect(parseHistoryFilters({ employee_id: "bad" }).errors).toContain("ตัวกรองพนักงานไม่ถูกต้อง");
    expect(parseHistoryFilters({ start_date: "2026-02-02", end_date: "2026-02-01" }).errors).toContain("วันที่เริ่มกรองต้องไม่หลังวันที่สิ้นสุด");
    expect(parseHistoryFilters({ status: ["recorded", "cancelled"] }).errors[0]).toContain("ซ้ำ");
    expect(parseHistoryFilters({ page: "99999999999999999999" }).errors).toContain("เลขหน้าไม่ถูกต้อง");
    expect(parseHistoryFilters({ q: "*" }).errors[0]).toContain("ไม่รองรับเครื่องหมาย *");
  });
  it("handles impossible year/date intersections as empty ranges and validates return paths", () => {
    const parsed=parseHistoryFilters({year:"2026",start_date:"2096-01-01"});
    expect(parsed.errors).toEqual([]);
    expect(historyRange(parsed.filters!)).toEqual({start:"2096-01-01",end:"2026-12-31"});
    expect(safeHistoryReturnTo("/workspace/leave?employee_id="+employeeId)).toBe("/workspace/leave?employee_id="+employeeId);
    expect(safeHistoryReturnTo("//evil.example")).toBe("/workspace/leave");
    expect(safeHistoryReturnTo("/workspace/leave/../../login")).toBe("/workspace/leave");
  });
  it("searches every token across employee code and names while treating wildcard characters literally", () => {
    expect(employeeSearchFilter("Somchai S")).toBe('and(or(employee_code.ilike."%Somchai%",first_name.ilike."%Somchai%",last_name.ilike."%Somchai%"),or(employee_code.ilike."%S%",first_name.ilike."%S%",last_name.ilike."%S%"))');
    expect(employeeSearchFilter("a%_")).toContain('"%a\\\\%\\\\_%"');
    expect(parseCalendarYear(["2026","2027"],2026).error).toBeTruthy();
  });
});
