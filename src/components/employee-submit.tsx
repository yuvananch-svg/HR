export function EmployeeSubmit({pending,children}: {pending:boolean;children:string}) {
  return <button disabled={pending}>{pending?"กำลังบันทึก…":children}</button>;
}
