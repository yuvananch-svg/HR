import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
const mocks=vi.hoisted(()=>({requireStaff:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("./auth",()=>({requireStaff:mocks.requireStaff}));
import { listLeaveHistory } from "./leave-history-server";
import { parseHistoryFilters } from "./leave-history";
function createFixtureClient(total=1005) {
 const requests:Array<{url:URL;prefer:string|null}>=[];
 const fetcher:typeof fetch=async(input,init)=>{
  const headers=new Headers(init?.headers??(input instanceof Request?input.headers:undefined));
  requests.push({url:new URL(String(input)),prefer:headers.get("Prefer")});
  return new Response("[]",{status:200,headers:{"content-type":"application/json","content-range":`0-${total-1}/${total}`}});
 };
 const client=createClient("https://fixture.supabase.co","test-publishable-key",{global:{fetch:fetcher},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 return {client,requests};
}
describe("server leave history query",()=>{
 beforeEach(()=>vi.clearAllMocks());
 it("uses exact count, joined filters and a stable clamped page through supabase-js",async()=>{
  const {client,requests}=createFixtureClient();mocks.requireStaff.mockResolvedValue({client});
  const parsed=parseHistoryFilters({employee_id:"11111111-1111-4111-8111-111111111111",leave_type_id:"22222222-2222-4222-8222-222222222222",status:"cancelled",year:"2026",start_date:"2026-12-20",end_date:"2027-01-10",q:"Somchai S",page:"99"});
  const result=await listLeaveHistory(parsed.filters!);
  expect(result).toMatchObject({total:1005,page:41,pageSize:25});
  expect(requests).toHaveLength(2);
  const [countRequest,pageRequest]=requests;
  expect(countRequest.url.searchParams.get("limit")).toBe("1");expect(countRequest.url.searchParams.get("offset")).toBe("0");
  expect(pageRequest.url.searchParams.get("offset")).toBe("1000");expect(pageRequest.url.searchParams.get("limit")).toBe("25");
  expect(countRequest.prefer).toContain("count=exact");expect(pageRequest.prefer).toContain("count=exact");
  for(const request of requests){
   expect(request.url.pathname).toBe("/rest/v1/leave_entries");
   expect(request.url.searchParams.get("employee_id")).toBe("eq.11111111-1111-4111-8111-111111111111");
   expect(request.url.searchParams.get("leave_type_id")).toBe("eq.22222222-2222-4222-8222-222222222222");
   expect(request.url.searchParams.get("status")).toBe("eq.cancelled");
   expect(request.url.searchParams.get("end_date")).toBe("gte.2026-12-20");
   expect(request.url.searchParams.get("start_date")).toBe("lte.2026-12-31");
   expect(request.url.searchParams.get("employees.or")).toContain("and(or(employee_code.ilike");
  }
  expect(pageRequest.url.searchParams.get("order")).toBe("created_at.desc,id.desc");
 });
 it("returns an empty year/date intersection without querying entries",async()=>{
  const {client,requests}=createFixtureClient();mocks.requireStaff.mockResolvedValue({client});
  const parsed=parseHistoryFilters({year:"2026",start_date:"2096-01-01"});
  expect(await listLeaveHistory(parsed.filters!)).toMatchObject({rows:[],total:0,page:1});
  expect(requests).toEqual([]);
 });
 it("runs the staff guard before the first database request",async()=>{
  const {requests}=createFixtureClient();mocks.requireStaff.mockRejectedValue(new Error("active_staff_required"));
  const parsed=parseHistoryFilters({q:"name"});
  await expect(listLeaveHistory(parsed.filters!)).rejects.toThrow("active_staff_required");
  expect(requests).toEqual([]);
 });
});
