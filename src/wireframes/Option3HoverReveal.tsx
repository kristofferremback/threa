import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option3HoverReveal: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const countReplies = (msg: Message): number => {
    if (!msg.replies) return 0;
    return msg.replies.length + msg.replies.reduce((acc, r) => acc + countReplies(r), 0);
  };

  const renderExpandedThread = (msg: Message) => {
    const renderMsg = (m: Message, depth = 0) => (
      <div key={m.id} style={{ marginLeft: `${depth * 20}px`, marginBottom: "12px" }}>
        <div style={{ fontSize: "13px" }}>
          <span style={{ fontWeight: 600 }}>{m.author}</span>
          <span style={{ color: "#666", marginLeft: "8px" }}>· {m.timestamp}</span>
        </div>
        <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>
          {m.content}
        </div>
        {m.replies && m.replies.map((reply) => (
          <div key={reply.id} style={{ marginTop: "8px", borderLeft: "2px solid #ddd", paddingLeft: "12px" }}>
            {renderMsg(reply, depth + 1)}
          </div>
        ))}
      </div>
    );

    return (
      <div
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          backgroundColor: "#fff",
          border: "2px solid #333",
          borderRadius: "8px",
          padding: "24px",
          maxWidth: "600px",
          maxHeight: "80vh",
          overflowY: "auto",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          zIndex: 1000,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>Thread</h3>
          <button
            onClick={() => setExpandedId(null)}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "24px",
              color: "#666",
            }}
          >
            ×
          </button>
        </div>
        {renderMsg(msg)}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
      </div>
      {messages.map((message) => {
        const replyCount = countReplies(message);
        const isHovered = hoveredId === message.id;

        return (
          <div key={message.id} style={{ marginBottom: "8px" }}>
            <div
              style={{
                padding: "12px",
                border: isHovered ? "2px solid #0066cc" : "1px solid #ddd",
                borderRadius: "4px",
                backgroundColor: "#fff",
                transition: "all 0.2s",
                position: "relative",
              }}
              onMouseEnter={() => setHoveredId(message.id)}
              onMouseLeave={() => setHoveredId(null)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600, fontSize: "14px" }}>{message.author}</span>
                <span style={{ color: "#666", fontSize: "12px" }}>· {message.timestamp}</span>
                {replyCount > 0 && (
                  <span style={{ fontSize: "12px", color: "#0066cc" }}>
                    · 💬 {replyCount}
                  </span>
                )}
              </div>
              <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.4" }}>
                {message.content}
              </div>

              {isHovered && replyCount > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: "4px",
                    padding: "12px",
                    backgroundColor: "#fff",
                    border: "2px solid #0066cc",
                    borderRadius: "4px",
                    boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                    zIndex: 10,
                  }}
                >
                  {message.replies!.slice(0, 2).map((reply) => {
                    const nestedCount = countReplies(reply);
                    return (
                      <div key={reply.id} style={{ fontSize: "13px", marginBottom: "8px", color: "#666" }}>
                        └─ <span style={{ fontWeight: 600 }}>{reply.author}</span>: {reply.content.slice(0, 40)}
                        {reply.content.length > 40 ? "..." : ""}
                        {nestedCount > 0 && ` (${nestedCount} more)`}
                      </div>
                    );
                  })}
                  <div style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setExpandedId(message.id)}
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        backgroundColor: "#0066cc",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      View full thread
                    </button>
                    <button
                      style={{
                        padding: "6px 12px",
                        fontSize: "12px",
                        backgroundColor: "#fff",
                        color: "#0066cc",
                        border: "1px solid #0066cc",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      Reply
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {expandedId && (
        <>
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.5)",
              zIndex: 999,
            }}
            onClick={() => setExpandedId(null)}
          />
          {renderExpandedThread(messages.find((m) => m.id === expandedId)!)}
        </>
      )}
    </div>
  );
};
