import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "./page";
const mocks = vi.hoisted(() => ({ signIn: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), membership: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(), useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }) }));
vi.mock("../lib/supabase/client", () => ({ createClient: () => ({ auth: { signInWithPassword: mocks.signIn, signUp: mocks.signUp, signOut: mocks.signOut }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.membership }) }) }) }) }));
function fill() { fireEvent.change(screen.getByLabelText("อีเมล"), { target: { value: "owner@example.test" } }); fireEvent.change(screen.getByLabelText("รหัสผ่าน"), { target: { value: "long-test-password" } }); }
describe("real login", () => {
 beforeEach(() => { vi.clearAllMocks(); mocks.signOut.mockResolvedValue({error:null}); });
 it("shows enabled credentials and keeps preview separate", () => { render(<LoginPage />); expect(screen.getByRole("button", { name: "เข้าสู่ระบบ" })).toBeEnabled(); expect(screen.getByRole("link", { name: /ดูตัวอย่างหน้าจอ/ })).toHaveAttribute("href", "/preview"); });
 it("does not navigate on invalid credentials", async () => { mocks.signIn.mockResolvedValue({data:{user:null},error:{}}); render(<LoginPage />); fill(); fireEvent.submit(screen.getByRole("form")); await screen.findByText(/เข้าสู่ระบบไม่ได้/); expect(mocks.replace).not.toHaveBeenCalled(); });
 it("signs out accounts without active membership", async () => { mocks.signIn.mockResolvedValue({data:{user:{id:"test"}},error:null}); mocks.membership.mockResolvedValue({data:null,error:null}); render(<LoginPage />); fill(); fireEvent.submit(screen.getByRole("form")); await screen.findByText(/ยังไม่มีสิทธิ์/); expect(mocks.signOut).toHaveBeenCalled(); expect(mocks.replace).not.toHaveBeenCalled(); });
 it("opens workspace for approved staff", async () => { mocks.signIn.mockResolvedValue({data:{user:{id:"test"}},error:null}); mocks.membership.mockResolvedValue({data:{role:"owner",is_active:true},error:null}); render(<LoginPage />); fill(); fireEvent.submit(screen.getByRole("form")); await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/workspace")); });
 it("requests email verification for initial setup", async () => { mocks.signUp.mockResolvedValue({error:null}); render(<LoginPage />); fireEvent.click(screen.getByRole("button",{name:"ตั้งรหัสผ่านครั้งแรก"})); fill(); fireEvent.submit(screen.getByRole("form")); await screen.findByText(/ตรวจกล่องอีเมล/); expect(mocks.signUp).toHaveBeenCalledWith(expect.objectContaining({email:"owner@example.test",options:expect.objectContaining({emailRedirectTo:expect.stringContaining("/auth/callback")})})); expect(mocks.replace).not.toHaveBeenCalled(); });
});
