import { notFound } from "next/navigation";
import { PreviewShell, type PreviewSection } from "@/components/preview-shell";

const validSections: PreviewSection[] = ["employees", "leave", "settings"];

export default async function PreviewSectionPage({ params }: { params: Promise<{ section: string }> }) {
  const { section } = await params;
  if (!validSections.includes(section as PreviewSection)) notFound();
  return <PreviewShell section={section as PreviewSection} />;
}
