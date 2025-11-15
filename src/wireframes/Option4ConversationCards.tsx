import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option4ConversationCards: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [expandedBranches, setExpandedBranches] = useState<Set<string>>(new Set());

  const toggleBranch = (id: string) => {
    const newExpanded = new Set(expandedBranches);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedBranches(newExpanded);
  };

  const renderBranch = (reply: Message, depth = 1) => {
    const isExpanded = expandedBranches.has(reply.id);
    const hasNested = reply.replies && reply.replies.length > 0;

    return (
      <div key={reply.id} style={{ marginTop: "12px", marginLeft: `${depth * 16}px` }}>
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: "12px",
            padding: "10px",
            backgroundColor: "#f9f9f9",
            borderLeft: "3px solid #0066cc",
            borderRadius: "4px",
          }}
        >
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "13px" }}>
              <span style={{ fontWeight: 600 }}>{reply.author}</span>
              <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
            </div>
            <div style={{ fontSize: "14px", marginTop: "4px" }}>{reply.content}</div>
          </div>
          {hasNested && (
            <button
              onClick={() => toggleBranch(reply.id)}
              style={{
                padding: "4px 10px",
                fontSize: "11px",
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "3px",
                cursor: "pointer",
              }}
            >
              {isExpanded ? "Collapse −" : `Expand + (${reply.replies!.length})`}
            </button>
          )}
        </div>
        {isExpanded && hasNested && (
          <div style={{ marginTop: "8px" }}>
            {reply.replies!.map((nested) => renderBranch(nested, depth + 1))}
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
                marginBottom: "16px",
                border: "2px solid #ddd",
                borderRadius: "8px",
                padding: "16px",
                backgroundColor: "#fff",
              }}
            >
              <div style={{ marginBottom: "12px", paddingBottom: "12px", borderBottom: "1px solid #eee" }}>
                <div style={{ fontSize: "13px", color: "#666", marginBottom: "8px" }}>
                  💬 Conversation · Started by {message.author} · {message.timestamp}
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

              <div style={{ fontSize: "14px", fontWeight: 600, marginBottom: "4px" }}>
                {message.author}
              </div>
              <div style={{ fontSize: "14px", lineHeight: "1.4", marginBottom: "12px" }}>
                {message.content}
              </div>

              {message.replies!.map((reply) => renderBranch(reply))}

              <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #eee" }}>
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
