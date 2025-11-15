import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option5TimelineJump: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [selectedThread, setSelectedThread] = useState<Message | null>(null);

  const countReplies = (msg: Message): number => {
    if (!msg.replies) return 0;
    return msg.replies.length + msg.replies.reduce((acc, r) => acc + countReplies(r), 0);
  };

  const renderThreadModal = (msg: Message) => {
    const renderMsg = (m: Message, depth = 0) => (
      <div key={m.id} style={{ marginBottom: "16px" }}>
        <div
          style={{
            padding: "12px",
            backgroundColor: depth === 0 ? "#f0f7ff" : "#fff",
            borderRadius: "4px",
            border: depth === 0 ? "2px solid #0066cc" : "1px solid #eee",
          }}
        >
          <div style={{ fontSize: "13px", color: "#666" }}>
            {m.timestamp} <span style={{ fontWeight: 600, color: "#000" }}>{m.author}</span>
          </div>
          <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>{m.content}</div>
        </div>
        {m.replies && m.replies.map((reply) => (
          <div key={reply.id} style={{ marginLeft: "32px", marginTop: "8px" }}>
            <div style={{ fontSize: "20px", color: "#0066cc", marginBottom: "4px" }}>↓</div>
            {renderMsg(reply, depth + 1)}
          </div>
        ))}
      </div>
    );

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
          onClick={() => setSelectedThread(null)}
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
              <h3 style={{ margin: 0, fontSize: "18px" }}>Thread: {msg.content.slice(0, 30)}...</h3>
              {msg.channels && (
                <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
                  {msg.channels.map((channel) => (
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
            <button
              onClick={() => setSelectedThread(null)}
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
        const replyCount = countReplies(message);

        return (
          <div
            key={message.id}
            style={{
              marginBottom: "16px",
              paddingBottom: "16px",
              borderBottom: "2px solid #eee",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: "12px", marginBottom: "8px" }}>
              <span style={{ fontSize: "13px", color: "#666", fontFamily: "monospace" }}>
                {message.timestamp}
              </span>
              <div style={{ height: "20px", width: "2px", backgroundColor: "#ddd" }} />
            </div>
            <div style={{ marginLeft: "80px" }}>
              <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
                {message.author}
              </div>
              <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{message.content}</div>
              {replyCount > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <button
                    onClick={() => setSelectedThread(message)}
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
                    → Started conversation ({replyCount} messages) Jump to thread ↗
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {selectedThread && renderThreadModal(selectedThread)}
    </div>
  );
};
