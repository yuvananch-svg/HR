-- Read-only evidence that independent PostgreSQL sessions overlap on the Phase 5 lock.
with a as (
  select pid from pg_stat_activity where application_name='hr_phase5_race_a' and datname=current_database()
), b as (
  select pid,wait_event_type,wait_event from pg_stat_activity
  where application_name='hr_phase5_race_b' and datname=current_database()
)
select 'STATUS:'||jsonb_build_object(
  'a_pid',(select pid from a),
  'b_pid',(select pid from b),
  'a_holds_advisory',exists(select 1 from a join pg_locks l using(pid) where l.locktype='advisory' and l.granted),
  'b_waiting_advisory',exists(select 1 from b join pg_locks l using(pid) where l.locktype='advisory' and not l.granted and b.wait_event_type='Lock' and b.wait_event='advisory'),
  'a_blocks_b',exists(select 1 from a,b where a.pid=any(pg_blocking_pids(b.pid)))
)::text;
