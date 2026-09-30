// Read every page: PostgREST normally limits one response to 1,000 rows.
export async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>) {
  const rows: T[] = [];
  const pageSize = 500;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await query(from, from + pageSize - 1);
    if (error) throw new Error("ไม่สามารถโหลดข้อมูลได้");
    rows.push(...(data ?? []));
    if ((data?.length ?? 0) < pageSize) return rows;
  }
}
