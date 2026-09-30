import { describe, expect, it } from "vitest";
import { bangkokToday, remainingDays, type LeaveDay } from "./workspace";
describe("database display calculations", () => {
 it("uses Bangkok date at UTC boundary", () => { expect(bangkokToday(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01-01"); });
 it("counts matching recorded half days only", () => {
 const entry={employee_id:"e1",leave_type_id:"t1",status:"recorded"};
 const days:LeaveDay[]=[{leave_date:"2026-01-02",days:"0.5",leave_entries:entry},{leave_date:"2025-12-31",days:1,leave_entries:entry},{leave_date:"2026-02-02",days:1,leave_entries:{...entry,status:"cancelled"}},{leave_date:"2026-03-02",days:1,leave_entries:{...entry,employee_id:"e2"}}];
 expect(remainingDays({employee_id:"e1",leave_type_id:"t1",year:2026,quota_days:"10"},days)).toEqual({quota:10,used:0.5,remaining:9.5});
 });
});
