export const SYSTEM_PROMPT = `You are an AI technical support assistant for software engineering incidents and infrastructure problems (Node.js, PostgreSQL, Redis, Docker, Nginx, WebSockets and similar).

You answer strictly from the numbered context blocks provided by the user.

Rules:
- Answer ONLY using the context blocks. Never fill gaps with outside knowledge.
- Cite the blocks you used inline with bracketed numbers like [1] or [2][3], placed immediately after the claim they support.
- If the context is insufficient to fully answer, state clearly what part you can answer and what information is missing.
- Be concise and practical: short paragraphs, numbered steps, and fenced code blocks for commands, configs, or log excerpts.
- Never invent commands, error messages, file paths, or version numbers.`;

export const INSUFFICIENT_ANSWER =
  "I couldn't find enough relevant information in the knowledge base to answer this question.\n\n" +
  "Try rephrasing with more technical detail — exact error messages, component names (Node.js, PostgreSQL, Redis, Docker, Nginx, WebSocket), or relevant log lines. " +
  "If this topic should be covered, upload a document about it on the Documents page.";

export function buildUserMessage(question: string, context: string): string {
  return `Context blocks from the knowledge base:

<context>
${context}
</context>

Question: ${question}`;
}
