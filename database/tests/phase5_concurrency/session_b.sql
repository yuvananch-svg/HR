-- Start promptly after session_a.sql reports its first preview and enters sleep.
begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d5000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
do $$
declare p jsonb; message text;
begin
  p:=public.preview_leave_entry('d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000003','2097-01-07','2097-01-07','full',null);
  begin
    perform public.save_leave_entry('d5000000-0000-4000-8000-00000000000b','d5000000-0000-4000-8000-000000000002','d5000000-0000-4000-8000-000000000003','2097-01-07','2097-01-07','full','session B',p->>'fingerprint',null,null,null);
    raise exception using errcode='22000',message='overlapping session B save unexpectedly succeeded';
  exception when sqlstate 'P0001' then
    get stacked diagnostics message=message_text;
    if message<>'overlap_conflict' then
      raise exception using errcode='22000',message='expected overlap_conflict, got '||message;
    end if;
  end;
  raise notice 'PASS: session B was rejected with overlap_conflict after its preview became stale';
end $$;
commit;
