import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireStaff } from "./auth";
const mocks = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { mocks.redirect(path); throw new Error("redirect:"+path); } }));
vi.mock("./supabase/server", () => ({ createClient: async () => ({
  auth: { getUser: mocks.user }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.member }) }) }),
}) }));
describe("server authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });
  it("redirects unauthenticated direct requests before querying private data", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: null });
    await expect(requireStaff()).rejects.toThrow("notice=login");
    expect(mocks.member).not.toHaveBeenCalled();
  });
  it("denies inactive memberships", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    mocks.member.mockResolvedValue({ data: { role: "owner", is_active: false }, error: null });
    await expect(requireStaff()).rejects.toThrow("notice=denied");
  });
  it("fails closed when membership cannot be loaded", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    mocks.member.mockResolvedValue({ data: null, error: {} });
    await expect(requireStaff()).rejects.toThrow("ไม่สามารถตรวจสิทธิ์");
  });
  it("permits authorized HR", async () => {
    mocks.user.mockResolvedValue({ data: { user: { id: "u" } }, error: null });
    mocks.member.mockResolvedValue({ data: { role: "hr", is_active: true }, error: null });
    expect((await requireStaff()).member.role).toBe("hr");
  });
});
