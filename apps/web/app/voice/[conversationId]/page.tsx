import { VoiceShell } from "@/components/voice/voice-shell";

export default async function ConversationVoicePage({
  params,
  searchParams,
}: {
  params: Promise<{ conversationId: string }>;
  searchParams: Promise<{ session?: string }>;
}) {
  const [{ conversationId }, query] = await Promise.all([params, searchParams]);
  return <VoiceShell conversationId={conversationId} initialSessionId={query.session} />;
}
