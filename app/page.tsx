"use client";

import { useState, type FormEvent } from "react";
import { errorMessage, postJson } from "./components/controls";

type Message = {
  role: "user" | "assistant";
  content: string;
};

export default function ChatPage() {
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSending || !text.trim()) return;

    // LLM APIs are stateless: the page keeps the conversation and resends all of it.
    const history: Message[] = [...messages, { role: "user", content: text }];
    setIsSending(true);
    setError(null);

    try {
      const { ok, data } = await postJson("/api/chat", { messages: history });
      if (!ok) throw new Error(errorMessage(data, "Unable to send your message. Please try again."));
      if (typeof data !== "object" || data === null || !("answer" in data) || typeof data.answer !== "string") {
        throw new Error("The server returned an invalid reply. Please try again.");
      }
      const answer = data.answer;
      setMessages([...history, { role: "assistant", content: answer }]);
      setText("");
    } catch (error) {
      // On failure the previous messages are kept, and the text stays in the box to retry.
      setError(error instanceof Error ? error.message : "Unable to send your message. Please try again.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <main className="page">
      <h1>Support chat</h1>
      <p className="muted">The conversation lives in this page only. Reloading clears it.</p>
      <div className="row">
        <button type="button" className="secondary" onClick={() => setMessages([])} disabled={isSending || !messages.length}>
          Clear chat
        </button>
      </div>
      <section className="messages" role="log" aria-label="Chat messages" aria-live="polite">
        {messages.length === 0 && <p>No messages yet.</p>}
        {messages.map((message, index) => (
          <div className={`message ${message.role}`} key={index}>
            <strong>{message.role === "user" ? "You" : "Assistant"}</strong>
            <p>{message.content}</p>
          </div>
        ))}
      </section>
      <form onSubmit={sendMessage} aria-busy={isSending}>
        <label htmlFor="message">Your message</label>
        <textarea
          id="message"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask anything..."
          rows={3}
          required
          disabled={isSending}
        />
        <button type="submit" disabled={isSending || !text.trim()}>
          {isSending ? "Sending..." : "Send"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
    </main>
  );
}
