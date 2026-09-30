import { expect, it } from "vitest";
import { readAll } from "./data";
it("continues beyond the API row cap and fails instead of showing partial totals", async () => {
  const rows = Array.from({length:1201},(_,id)=>({id}));
  expect((await readAll(async (from,to)=>({data:rows.slice(from,to+1),error:null}))).length).toBe(1201);
  await expect(readAll(async()=>({data:null,error:{}}))).rejects.toThrow();
});
