-- Defense in depth for the idempotency request ledger. RPCs use SECURITY
-- DEFINER; clients have no table grants and this policy denies authenticated
-- rows even if table privileges are expanded later.
create index leave_entry_requests_entry_id_idx
  on public.leave_entry_requests(entry_id);

create policy leave_entry_requests_deny_authenticated
  on public.leave_entry_requests
  for all
  to authenticated
  using (false)
  with check (false);
