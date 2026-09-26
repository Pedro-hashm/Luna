import { ChatShell } from "@/components/chat/chat-shell";

export default async function ConversationPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  return <ChatShell initialConversationId={conversationId} />;
}
