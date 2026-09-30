import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({requireStaff:vi.fn(),revalidatePath:vi.fn(),redirect:vi.fn(),rpc:vi.fn(),from:vi.fn()}));
vi.mock("@/lib/auth",()=>({requireStaff:mocks.requireStaff}));
vi.mock("next/cache",()=>({revalidatePath:mocks.revalidatePath}));
vi.mock("next/navigation",()=>({redirect:mocks.redirect}));

import { generateEntitlementsAction, overrideEntitlementAction, saveHolidayAction, saveLeavePolicyAction } from "./settings-actions";

function form(values:Record<string,string>) {
  const data=new FormData();
  for(const [key,value] of Object.entries(values)) data.set(key,value);
  return data;
}
async function redirectedNotice(promise:Promise<unknown>) {
  try { await promise; throw new Error("Expected redirect"); }
  catch(error) {
    const message=String(error);
    const url=message.startsWith("Error: redirect:")?message.slice("Error: redirect:".length):message;
    return decodeURIComponent(url);
  }
}

describe("leave policy server actions",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();
    mocks.requireStaff.mockResolvedValue({client:{rpc:mocks.rpc,from:mocks.from}});
    mocks.redirect.mockImplementation((url:string)=>{throw new Error("redirect:"+url)});
  });

  it("rejects an empty standard quota instead of coercing it to zero",async()=>{
    const notice=await redirectedNotice(saveLeavePolicyAction(form({leave_type_id:"type-1",year:"2026",quota_days:""})));
    expect(notice).toContain("โควตาต้องเป็น 0");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("requires a reason and a nonempty half-day-step personal quota",async()=>{
    const notice=await redirectedNotice(overrideEntitlementAction(form({employee_id:"employee-1",leave_type_id:"type-1",year:"2026",revision:"rev",quota_days:"1"})));
    expect(notice).toContain("เหตุผล");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects an impossible holiday date before the write RPC",async()=>{
    const notice=await redirectedNotice(saveHolidayAction(form({holiday_date:"2026-02-30",name:"Invalid date"})));
    expect(notice).toContain("วันที่และชื่อวันหยุดให้ถูกต้อง");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("routes generation through the atomic database RPC and revalidates",async()=>{
    mocks.rpc.mockResolvedValue({data:0,error:null});
    await expect(generateEntitlementsAction(form({year:"2026"}))).rejects.toThrow("/workspace/settings?notice=");
    expect(mocks.rpc).toHaveBeenCalledWith("generate_leave_entitlements",{p_year:2026});
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace", "layout");
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/workspace/employees/[id]", "page");
  });

  it("does not call a write RPC when active-staff authorization fails",async()=>{
    mocks.requireStaff.mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(generateEntitlementsAction(form({year:"2026"}))).rejects.toThrow("NEXT_REDIRECT");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
