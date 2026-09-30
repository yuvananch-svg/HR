import { RevealSensitive } from "@/components/reveal-sensitive";
import { RelatedForm } from "@/components/employee-related";

type SensitiveRow = Record<string, string | number | boolean | null | undefined> & {id:string;updated_at:string};
export function EmployeeSensitiveControls({employeeId,employeeUpdatedAt,section,row,label}: {employeeId:string;employeeUpdatedAt:string;section:"document"|"bank";row:SensitiveRow;label:string}) {
  return <>
    <RevealSensitive key={`reveal:${row.id}:${row.updated_at}`} employeeId={employeeId} section={section} rowId={row.id} revision={row.updated_at} label={label} />
    <RelatedForm key={`editor:${row.id}:${row.updated_at}:${section === "bank" ? employeeUpdatedAt : ""}`} kind={section} employeeId={employeeId} employeeUpdatedAt={employeeUpdatedAt} row={row} />
  </>;
}
