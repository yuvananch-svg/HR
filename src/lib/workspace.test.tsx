import { describe, expect, it } from "vitest";
import { bangkokToday, hasEntitlement, recordedUsageByEmployeeTypeYear, remainingDays, summarizeLeaveTypes, uniquePeopleOnLeave, type LeaveDay } from "./workspace";
describe("database display calculations", () => {
 it("uses Bangkok date at UTC boundary", () => { expect(bangkokToday(new Date("2026-12-31T18:00:00Z"))).toBe("2027-01-01"); });
 it("counts matching recorded half days only", () => {
 const entry={employee_id:"e1",leave_type_id:"t1",status:"recorded"};
 const days:LeaveDay[]=[{leave_date:"2026-01-02",days:"0.5",leave_entries:entry},{leave_date:"2025-12-31",days:1,leave_entries:entry},{leave_date:"2026-02-02",days:1,leave_entries:{...entry,status:"cancelled"}},{leave_date:"2026-03-02",days:1,leave_entries:{...entry,employee_id:"e2"}}];
 expect(remainingDays({employee_id:"e1",leave_type_id:"t1",year:2026,quota_days:"10"},days)).toEqual({quota:10,used:0.5,remaining:9.5});
 });
 it("separates missing entitlement from a real zero quota and totals recorded charges by employee/type/year",()=>{
  const days:LeaveDay[]=[
   {leave_date:"2026-12-31",days:1,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"recorded"}},
   {leave_date:"2027-01-01",days:0.5,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"recorded"}},
   {leave_date:"2026-06-01",days:0.5,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"recorded"}},
   {leave_date:"2026-05-01",days:1,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"cancelled"}},
  ];
  const usage=recordedUsageByEmployeeTypeYear(days);
  expect(usage.get("e1:t1:2026")).toBe(1.5);
  expect(usage.get("e1:t1:2027")).toBe(0.5);
  expect(remainingDays({employee_id:"e1",leave_type_id:"t1",year:2026,quota_days:0},days)).toEqual({quota:0,used:1.5,remaining:-1.5});
  expect(hasEntitlement([],"e1","t1",2026)).toBe(false);
  expect(hasEntitlement([{employee_id:"e1",leave_type_id:"t1",year:2026,quota_days:0}],"e1","t1",2026)).toBe(true);
 });
 it("counts people instead of charge-day rows",()=>{
  const rows=Array.from({length:1205},(_,i)=>({leave_entries:{employee_id:i<1200?"same":`e${i}`,leave_type_id:"t1",status:"recorded"}}));
  expect(uniquePeopleOnLeave(rows)).toBe(6);
 });
 it("summarizes quota per type without conflating missing entitlement and zero quota",()=>{
  const days:LeaveDay[]=[...Array.from({length:1200},()=>({leave_date:"2026-01-02",days:1,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"recorded"}} as LeaveDay)),
   {leave_date:"2026-12-31",days:0.5,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"recorded"}},
   {leave_date:"2026-01-03",days:1,leave_entries:{employee_id:"e1",leave_type_id:"t1",status:"cancelled"}},
   {leave_date:"2027-01-01",days:1,leave_entries:{employee_id:"e2",leave_type_id:"t2",status:"recorded"}}];
  const summary=summarizeLeaveTypes(2026,[{id:"t1",name:"Annual",is_active:true},{id:"t2",name:"Old type",is_active:false},{id:"t3",name:"Sick",is_active:true}],
   [{employee_id:"e1",leave_type_id:"t1",quota_days:0},{employee_id:"e2",leave_type_id:"t2",quota_days:3}],days);
  expect(summary).toEqual([
   {id:"t1",name:"Annual",active:true,quota:0,used:1200.5,entitledPeople:1,hasEntitlement:true},
   {id:"t3",name:"Sick",active:true,quota:0,used:0,entitledPeople:0,hasEntitlement:false},
   {id:"t2",name:"Old type",active:false,quota:3,used:0,entitledPeople:1,hasEntitlement:true},
  ]);
 });
});
