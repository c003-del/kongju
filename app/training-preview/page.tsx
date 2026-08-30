import type { Metadata } from "next";
import { notFound } from "next/navigation";
import FamilyArchive from "@/components/design/family-archive";
import { createTrainingPreviewData } from "@/lib/demo-data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "연습용 화면 미리보기",
  robots: { index: false, follow: false },
};

export default function TrainingPreviewPage() {
  if (process.env.TRAINING_PREVIEW_ENABLED !== "true") {
    notFound();
  }

  return <FamilyArchive initial={createTrainingPreviewData()} demoMode />;
}
