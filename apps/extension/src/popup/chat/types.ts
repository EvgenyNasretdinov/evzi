/** Placeholder until LLM / backend streaming is wired. */
export const EVZI_CHAT_PLACEHOLDER_REPLY = `Sorry, I can’t answer right now… I’m having a little trouble reaching the network.

Let’s try again later.`;

export type ChatRole = "user" | "assistant";

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
}

export function createChatMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content,
    createdAt: Date.now(),
  };
}

/** Demo thread for previews — matches design direction (user bubble + EVZI reply). */
export const CHAT_DEMO_MESSAGES: ChatMessage[] = [
  {
    id: "demo-user-1",
    role: "user",
    content: "Why do I have a weird token in my wallet?",
    createdAt: 0,
  },
  {
    id: "demo-assistant-1",
    role: "assistant",
    content: `Anyone can send tokens to a public wallet address — even if you never asked for them.

Sometimes these tokens are harmless spam, but some are designed to lure people into scam websites, fake airdrops, or dangerous approvals. It’s usually best not to interact with tokens you don’t recognize.

If you want, you can send me the token address and I’ll help you figure out what it is.`,
    createdAt: 1,
  },
];
