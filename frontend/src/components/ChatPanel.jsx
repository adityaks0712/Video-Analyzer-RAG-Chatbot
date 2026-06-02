import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { v4 as uuidv4 } from "uuid";

const SESSION_ID = uuidv4();

const QUICK_PROMPTS = [
  "Why did Video A get more engagement than B?",
  "Compare the hooks in the first 5 seconds",
  "What's the engagement rate of each?",
  "Suggest improvements for B based on A",
  "Who created Video B? What are their follower count?",
];

function CitationBadge({ citation }) {
  const isA = citation.video_id === "A";
  return (
    <span className={`citation-badge ${isA ? "cite-a" : "cite-b"}`}>
      Video {citation.video_id}
      {citation.chunk_type === "metadata" ? " [meta]" : ` [chunk]`}
    </span>
  );
}

function Message({ msg }) {
  const isUser = msg.role === "user";
  const isStreaming = msg.streaming;

  return (
    <div className={`message ${isUser ? "msg-user" : "msg-assistant"}`}>
      <div className="msg-avatar">{isUser ? "You" : "AI"}</div>
      <div className="msg-body">
        {msg.citations && msg.citations.length > 0 && (
          <div className="msg-citations">
            <span className="citations-label">Sources:</span>
            {msg.citations.map((c, i) => (
              <CitationBadge key={i} citation={c} />
            ))}
          </div>
        )}
        <div className={`msg-content ${isStreaming ? "streaming" : ""}`}>
          {isUser ? (
            <p>{msg.content}</p>
          ) : (
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {msg.content || ""}
            </ReactMarkdown>
          )}
          {isStreaming && <span className="cursor-blink">▋</span>}
        </div>
      </div>
    </div>
  );
}

export default function ChatPanel({ apiBase, videos }) {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content:
        "Videos loaded ✓ — I've indexed both transcripts and metadata. Ask me anything about engagement, content strategy, hooks, creator info, or improvements.",
      citations: [],
    },
  ]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = useCallback(
    async (text) => {
      const question = text || input.trim();
      if (!question || streaming) return;

      setInput("");
      setStreaming(true);

      // Add user message
      setMessages((prev) => [
        ...prev,
        { role: "user", content: question },
      ]);

      // Add placeholder assistant message
      const assistantIdx = Date.now();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "", citations: [], streaming: true, _id: assistantIdx },
      ]);

      try {
        const controller = new AbortController();
        abortRef.current = controller;

        const res = await fetch(`${apiBase}/api/chat/stream`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: question, session_id: SESSION_ID }),
          signal: controller.signal,
        });

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let citations = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop(); // keep incomplete line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const raw = line.slice(6).trim();
            if (raw === "[DONE]") break;

            try {
              const evt = JSON.parse(raw);

              if (evt.type === "citations") {
                citations = evt.citations;
                setMessages((prev) =>
                  prev.map((m) =>
                    m._id === assistantIdx ? { ...m, citations } : m
                  )
                );
              } else if (evt.type === "token") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m._id === assistantIdx
                      ? { ...m, content: m.content + evt.content }
                      : m
                  )
                );
              } else if (evt.type === "done") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m._id === assistantIdx ? { ...m, streaming: false } : m
                  )
                );
              } else if (evt.type === "error") {
                setMessages((prev) =>
                  prev.map((m) =>
                    m._id === assistantIdx
                      ? { ...m, content: `⚠ Error: ${evt.content}`, streaming: false }
                      : m
                  )
                );
              }
            } catch (_) {}
          }
        }
      } catch (e) {
        if (e.name !== "AbortError") {
          setMessages((prev) =>
            prev.map((m) =>
              m.streaming ? { ...m, content: `⚠ ${e.message}`, streaming: false } : m
            )
          );
        }
      } finally {
        setStreaming(false);
        abortRef.current = null;
        setMessages((prev) =>
          prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
        );
      }
    },
    [input, streaming, apiBase]
  );

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
    setStreaming(false);
    setMessages((prev) =>
      prev.map((m) => (m.streaming ? { ...m, streaming: false } : m))
    );
  };

  return (
    <div className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">Chat with your videos</span>
        <div className="chat-status">
          <span className="status-dot" />
          {Object.keys(videos).length} video{Object.keys(videos).length !== 1 ? "s" : ""} loaded
        </div>
      </div>

      <div className="quick-prompts">
        {QUICK_PROMPTS.map((q, i) => (
          <button
            key={i}
            className="quick-btn"
            onClick={() => sendMessage(q)}
            disabled={streaming}
          >
            {q}
          </button>
        ))}
      </div>

      <div className="messages-area">
        {messages.map((msg, i) => (
          <Message key={i} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="chat-input-row">
        <textarea
          ref={textareaRef}
          className="chat-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask about engagement, hooks, strategy, creators..."
          rows={2}
          disabled={streaming}
        />
        <button
          className={`btn-send ${streaming ? "btn-stop" : ""}`}
          onClick={streaming ? handleStop : () => sendMessage()}
          disabled={!streaming && !input.trim()}
        >
          {streaming ? "■" : "↑"}
        </button>
      </div>
    </div>
  );
}
