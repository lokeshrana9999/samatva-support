import { redirect } from "next/navigation";
import { config } from "@config";
import { crisisLinesFor } from "@/core/turn";
import { ChatApp } from "@/components/chat-app";
import { requireReviewer } from "@/app/lib/reviewer";

// The same cookie check as every API route, in the page's server component;
// no middleware (design D5).
export default async function Home() {
  if (!(await requireReviewer())) redirect("/login");
  return <ChatApp defaultLines={crisisLinesFor(config, false)} />;
}
