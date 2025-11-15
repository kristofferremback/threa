import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option10ConversationFirst: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());

  const toggleThread = (id: string) => {
    const newExpanded = new Set(expandedThreads);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedThreads(newExpanded);
  };

  const countNestedReplies = (msg: Message): number => {
    if (!msg.replies) return 0;
    return msg.replies.length + msg.replies.reduce((acc, r) => acc + countNestedReplies(r), 0);
  };

  const renderThread = (reply: Message, depth = 0) => {
    const isExpanded = expandedThreads.has(reply.id);
    const nestedCount = countNestedReplies(reply);

    return (
      <div key={reply.id} style={{ marginBottom: "12px" }}>
        <div
          style={{
            padding: "10px",
            backgroundColor: "#f9f9f9",
            borderLeft: "3px solid #0066cc",
            borderRadius: "4px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>{reply.author}</span>
                <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
              </div>
              <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>
                {reply.content}
              </div>
              {!isExpanded && reply.replies && reply.replies.length > 0 && (
                <div style={{ marginTop: "6px", fontSize: "12px", color: "#666" }}>
                  {reply.replies.map((r) => (
                    <div key={r.id}>
                      {r.author}: {r.content.slice(0, 30)}...
                    </div>
                  ))}
                </div>
              )}
            </div>
            {nestedCount > 0 && (
              <button
                onClick={() => toggleThread(reply.id)}
                style={{
                  padding: "4px 8px",
                  fontSize: "11px",
                  backgroundColor: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "3px",
                  cursor: "pointer",
                  marginLeft: "8px",
                }}
              >
                {isExpanded ? "−" : `+${nestedCount} more`}
              </button>
            )}
          </div>
        </div>
        {isExpanded && reply.replies && (
          <div style={{ marginLeft: "20px", marginTop: "8px" }}>
            {reply.replies.map((nested) => renderThread(nested, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
      </div>

      {messages.map((message) => {
        const hasReplies = message.replies && message.replies.length > 0;

        if (hasReplies) {
          return (
            <div
              key={message.id}
              style={{
                marginBottom: "20px",
                border: "2px solid #0066cc",
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "#fff",
              }}
            >
              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid #eee" }}>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "4px" }}>
                  🔗 CONVERSATION
                </div>
                {message.channels && (
                  <div style={{ display: "flex", gap: "4px" }}>
                    {message.channels.map((channel) => (
                      <span
                        key={channel}
                        style={{
                          fontSize: "11px",
                          color: "#0066cc",
                          backgroundColor: "#e6f2ff",
                          padding: "2px 6px",
                          borderRadius: "3px",
                        }}
                      >
                        {channel}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "13px" }}>
                  <span style={{ fontWeight: 600 }}>{message.author}</span>
                  <span style={{ color: "#666", marginLeft: "8px" }}>· {message.timestamp}</span>
                </div>
                <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>
                  {message.content}
                </div>
              </div>

              <div style={{ marginBottom: "12px" }}>
                {message.replies!.map((reply) => (
                  <div key={reply.id} style={{ marginBottom: "8px" }}>
                    <div
                      style={{
                        fontSize: "12px",
                        color: "#666",
                        marginBottom: "4px",
                        paddingLeft: "8px",
                        borderLeft: "2px solid #eee",
                      }}
                    >
                      Thread {message.replies!.indexOf(reply) + 1}
                    </div>
                    {renderThread(reply)}
                  </div>
                ))}
              </div>

              <div style={{ paddingTop: "12px", borderTop: "1px solid #eee" }}>
                <button
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    backgroundColor: "#0066cc",
                    color: "#fff",
                    border: "none",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  + Reply to conversation
                </button>
              </div>
            </div>
          );
        }

        return (
          <div
            key={message.id}
            style={{
              marginBottom: "8px",
              padding: "12px",
              borderTop: "1px solid #ddd",
              borderBottom: "1px solid #ddd",
            }}
          >
            <span style={{ fontWeight: 600, fontSize: "14px" }}>{message.author}</span>
            <span style={{ color: "#666", fontSize: "12px", marginLeft: "8px" }}>
              · {message.timestamp}
            </span>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>{message.content}</div>
          </div>
        );
      })}
    </div>
  );
};
