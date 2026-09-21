import { ContextManagerService } from "./context-manager.service";

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
});

function message(id: string, content: string) {
    return {
        id,
        role: "user" as const,
        content,
        createdAt: "2026-09-21T00:00:00.000Z",
    };
}
