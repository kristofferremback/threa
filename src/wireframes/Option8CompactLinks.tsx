import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option8CompactLinks: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const getParticipants = (msg: Message): string[] => {
    const participants: string[] = [];
    const collect = (m: Message) => {
      if (m.replies) {
        m.replies.forEach((r) => {
          participants.push(r.author);
          collect(r);
        });
      }
    };
    collect(msg);
    return participants;
  };

  const renderThreadModal = (msg: Message) => {
    let stepNumber = 1;
    const renderMsg = (m: Message, depth = 0): JSX.Element => {
      const currentStep = stepNumber++;
      return (
        <div key={m.id} style={{ marginBottom: "16px" }}>
          <div
            style={{
              padding: "12px",
              backgroundColor: depth === 0 ? "#f0f7ff" : "#fff",
              borderLeft: depth > 0 ? "3px solid #0066cc" : "none",
              marginLeft: `${depth * 20}px`,
            }}
          >
            <div style={{ fontSize: "13px", color: "#666", marginBottom: "4px" }}>
              {currentStep}. {m.author} · {m.timestamp}
            </div>
            <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{m.content}</div>
          </div>
          {m.replies && m.replies.length > 0 && (
            <div>
              {m.replies.map((reply) => (
                <div key={reply.id}>
                  <div
                    style={{
                      marginLeft: `${depth * 20 + 40}px`,
                      fontSize: "18px",
                      color: "#0066cc",
                      marginBottom: "4px",
                    }}
                  >
                    ↓
                  </div>
                  {renderMsg(reply, depth + 1)}
                </div>
              ))}
            </div>
          )}
        </div>
      );
    };

    return (
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
        <div
          style={{
            position: "fixed",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            backgroundColor: "#fff",
            borderRadius: "8px",
            padding: "24px",
            maxWidth: "700px",
            maxHeight: "80vh",
            overflowY: "auto",
            boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
            zIndex: 1000,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "18px" }}>💬 Thread from {msg.author}'s message</h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "14px", color: "#666" }}>
                "{msg.content}"
              </p>
            </div>
            <button
              onClick={() => setExpandedId(null)}
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: "28px",
                color: "#666",
              }}
            >
              ×
            </button>
          </div>
          {renderMsg(msg)}
          <div style={{ marginTop: "20px", paddingTop: "16px", borderTop: "1px solid #ddd" }}>
            <input
              type="text"
              placeholder="Type reply..."
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
              }}
            />
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
      </div>

      {messages.map((message) => {
        const participants = getParticipants(message);
        const hasReplies = participants.length > 0;

        return (
          <div
            key={message.id}
            style={{
              marginBottom: "12px",
              paddingBottom: "12px",
              borderBottom: "1px solid #eee",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 600, fontSize: "14px" }}>{message.author}</span>
              <span style={{ color: "#666", fontSize: "12px" }}>· {message.timestamp}</span>
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
            <div style={{ fontSize: "14px", lineHeight: "1.4", marginBottom: "4px" }}>
              {message.content}
            </div>
            {hasReplies && (
              <div style={{ fontSize: "12px", color: "#666", marginTop: "6px" }}>
                ├ {participants.join(", ")} →{" "}
                <button
                  onClick={() => setExpandedId(message.id)}
                  style={{
                    padding: "2px 8px",
                    fontSize: "12px",
                    backgroundColor: "#0066cc",
                    color: "#fff",
                    border: "none",
                    borderRadius: "3px",
                    cursor: "pointer",
                    marginLeft: "4px",
                  }}
                >
                  View {participants.length + 1} replies
                </button>
              </div>
            )}
          </div>
        );
      })}

      {expandedId && renderThreadModal(messages.find((m) => m.id === expandedId)!)}
    </div>
  );
};
