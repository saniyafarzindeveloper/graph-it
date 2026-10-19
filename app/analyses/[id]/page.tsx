import { auth } from "@clerk/nextjs/server";
import { notFound, redirect } from "next/navigation";
import { AnalysisProgress } from "@/components/analysis-progress";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export const instant = false;

type PageProps = { params: Promise<{ id: string }> };

export default async function AnalysisProgressPage({ params }: PageProps) {
  await auth.protect();
  const [{ id }, { orgId, getToken }] = await Promise.all([params, auth()]);
  const token = orgId ? await getToken() : null;
  if (!orgId || !token) notFound();

  const client = getSupabaseServerClient(token);
  const { data, error } = await client.from("analyses")
    .select("id,name,status,stage,stage_message,failed_stage,error_message,commit_sha,coverage,folder_count,summary,created_at,completed_at")
    .eq("id", id)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (error || !data) notFound();
  if (data.status === "completed") redirect(`/analyses/${id}/map`);

  return <AnalysisProgress initialAnalysis={data} token={token} />;
}
