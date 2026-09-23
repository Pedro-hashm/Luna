import { ContextManagerService } from "./context-manager.service";
import { toRuntimeChatMessages } from "./runtime-context";

describe("ContextManagerService", () => {
    const service = new ContextManagerService();

    it("keeps the newest chronological suffix within the token budget", () => {
        const messages = [
            message("first", "a".repeat(20)),
            message("second", "b".repeat(20)),
            message("third", "c".repeat(20)),
        ];

        const recent = service.buildRecentMessages(messages, 14);

        expect(recent.map((item) => item.id)).toEqual(["second", "third"]);
        expect(service.estimateMessagesTokens(recent)).toBeLessThanOrEqual(14);
    });

    it("preserves and truncates the latest message when it alone exceeds the budget", () => {
        const recent = service.buildRecentMessages(
            [message("latest", "a".repeat(80))],
            8,
        );

        expect(recent).toHaveLength(1);
        expect(recent[0].id).toBe("latest");
        expect(recent[0].content.endsWith("…")).toBe(true);
        expect(service.estimateMessagesTokens(recent)).toBeLessThanOrEqual(8);
    });

    it("keeps Evidence attached to its source assistant message and immediately below it", () => {
        const messages = [
            { ...message("old", "old response"), role: "assistant" as const, evidence: [{ evidence_id: "ev_1", date_from: "2026-09-12", date_to: "2026-09-12", dates: ["2026-09-12"] }] },
            message("latest", "What day was that?"),
        ];
        const recent = service.buildRecentMessages(messages, 100);
        const promptMessages = toRuntimeChatMessages(recent);

        expect(promptMessages.map((item) => item.role)).toEqual(["assistant", "system", "user"]);
        expect(promptMessages[1].content).toContain('"evidence_id":"ev_1"');
        expect(promptMessages[1].content).toContain('"dates":["2026-09-12"]');
    });

    it("drops old Evidence together with its message when the recent context budget excludes that message", () => {
        const old = { ...message("old", "x".repeat(80)), role: "assistant" as const, evidence: [{ evidence_id: "ev_1", date_from: "2026-09-12", date_to: "2026-09-12", dates: ["2026-09-12"] }] };
        const latest = message("latest", "current");
        const maxTokens = service.estimateMessageTokens(latest) + 1;

        const recent = service.buildRecentMessages([old, latest], maxTokens);

        expect(recent.map((item) => item.id)).toEqual(["latest"]);
        expect(recent.some((item) => item.evidence?.some((entry) => entry.evidence_id === "ev_1"))).toBe(false);
    });
});

function message(id: string, content: string) {
    return {
        id,
        role: "user" as const,
        content,
        createdAt: "2026-09-21T00:00:00.000Z",
    };
}
