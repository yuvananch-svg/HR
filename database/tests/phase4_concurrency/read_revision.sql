select updated_at as expected_revision
from public.leave_entitlements
where employee_id='d4000000-0000-4000-8000-000000000002'
  and leave_type_id='d4000000-0000-4000-8000-000000000003'
  and year=2098;
