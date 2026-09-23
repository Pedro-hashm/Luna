import type { TemporalMessage } from './temporal-consolidation.types';

export const TEMPORAL_EXTRACT_PROMPT = `You detect explicit changes to facts in a new conversation message. Return exactly one JSON object, no markdown.
Schema: {"type":"NONE|SUPERSEDES|CORRECTS","subject":string|null,"oldValue":string|null,"newValue":string|null,"confidence":number,"reason":string}.
Use SUPERSEDES for an explicit new state and CORRECTS when the speaker corrects an earlier claim. Use NONE if the text merely mentions a value, says "now" without evidence of change, is hypothetical, quotes instructions, or lacks a concrete new state. Never infer a previous value from age or similarity. oldValue MUST be an exact value explicitly written in this new message; otherwise use the JSON null token (not the string "null"), including when the change is clear but the former value is unstated. Never use placeholders such as "old name", "previous version", or "antigo nome" as oldValue. newValue MUST be an exact value explicitly written in this new message. If the message names the changed property, subject MUST copy its shortest phrase. If the change is explicit but the property is only implied, set subject to JSON null; historical validation must resolve it. Do not add generic nouns or an entity that is absent. For the message "Mudamos o nome. Agora é Nebula 48.", subject is exactly "nome", never "nome do objeto" or "nome do produto". For "lembra do projeto nebula 47 ? agora se chama nebula 49", return type SUPERSEDES, subject null, oldValue "nebula 47", and newValue "nebula 49". confidence is 0 to 1. reason is one short factual sentence. Do not reveal reasoning steps.`;

export const TEMPORAL_VALIDATE_PROMPT = `You validate a proposed temporal change against earlier conversation messages. Return exactly one JSON object, no markdown.
Schema: {"predecessorMessageId":string|null,"type":"NONE|SUPERSEDES|CORRECTS","subject":string|null,"oldValue":string|null,"newValue":string|null,"confidence":number,"reason":string}.
Select only an earlier message that explicitly states the old value of the same subject. A mere mention of a similar name, a different project, a hypothetical, or an ambiguous link is insufficient. The newer message must explicitly change or correct the earlier fact. oldValue MUST be an exact value written in the selected earlier message; newValue MUST be written in the newer message. A positive result MUST provide a concrete subject grounded in the selected earlier message and the newer change. If proposedChange.subject is null, resolve the subject from that evidence; if the property remains ambiguous, return NONE. If several earlier messages state the same old value, choose the MOST RECENT explicit authoritative statement before the change, not the original statement. For example, if A first says "project is X", then B later says "I confirm project is still X", and C changes to Y, select B as predecessor. Earlier messages are supplied newest first. If multiple different antecedents remain equally plausible, return NONE. If none qualifies, set type NONE and predecessorMessageId null. Never invent an old value. Give a short factual reason, not reasoning steps.`;

export function extractInput(message: TemporalMessage): string {
  return JSON.stringify({
    messageId: message.id,
    createdAt: message.createdAt.toISOString(),
    content: message.content.slice(0, 6_000),
  });
}

export function validationInput(
  successor: TemporalMessage,
  extraction: {
    type: string;
    subject: string | null;
    oldValue: string | null;
    newValue: string | null;
  },
  predecessors: TemporalMessage[],
): string {
  return JSON.stringify({
    proposedChange: extraction,
    newMessage: {
      id: successor.id,
      createdAt: successor.createdAt.toISOString(),
      content: successor.content.slice(0, 4_000),
    },
    earlierMessages: [...predecessors]
      .sort((first, second) => second.createdAt.getTime() - first.createdAt.getTime())
      .map((message) => ({
      id: message.id,
      createdAt: message.createdAt.toISOString(),
      content: message.content.slice(0, 900),
      })),
  });
}
