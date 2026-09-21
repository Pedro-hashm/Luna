export type ConversationRetrievalInput = {
    query?: string;
    dateFrom?: string;
    dateTo?: string;
    searchCurrentConversation?: boolean;
    maxContextTokens?: number;
    includeMessages?: boolean;
};

export type ConversationRetrievalMessage = {
    id: string;
    role: string;
    content: string;
    createdAt: Date;
};

export type ConversationRetrievalItem = {
    conversationId: string;
    chunkId: string;
    status: "open" | "closed";
    score: number;
    content: string;
    tailContent?: string;
    startMessageId: string;
    endMessageId: string;
    tokenCount: number;
    messages?: ConversationRetrievalMessage[];
};

export type ConversationRetrievalResult = {
    query: string | null;
    results: ConversationRetrievalItem[];
};
