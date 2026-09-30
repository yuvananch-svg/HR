"use client";
import type { FormEvent, ReactNode } from "react";
export function ConfirmSubmit({children,message,action}:{children:ReactNode;message:string;action?:(data:FormData)=>void|Promise<void>}) {
  const confirmSubmit=(event:FormEvent<HTMLFormElement>)=>{if(!confirm(message))event.preventDefault()};
  return <form action={action} onSubmit={confirmSubmit}>{children}</form>;
}
