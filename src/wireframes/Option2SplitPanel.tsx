import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

const ThreadView: React.FC<{ message: Message | null; onClose: () => void }> = ({ message, onClose }) => {
  if (!message) return null;

  const renderThread = (msg: Message, depth = 0) => (
    <div key={msg.id} style={{ marginLeft: `${depth * 16}px`, marginBottom: "12px" }}>
      <div style={{ fontSize: "13px" }}>
        <span style={{ fontWeight: 600 }}>{msg.author}</span>
        <span style={{ color: "#666", marginLeft: "8px" }}>· {msg.timestamp}</span>
      </div>
      <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>
        {msg.content}
      </div>
      {msg.replies && msg.replies.map((reply) => (
        <div key={reply.id} style={{ marginTop: "12px", borderLeft: "2px solid #ddd", paddingLeft: "12px" }}>
          {renderThread(reply, depth + 1)}
        </div>
      ))}
    </div>
  );

  return (
    <div style={{ padding: "16px", height: "100%", overflowY: "auto" }}>
      <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #ddd" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>💬 Thread</h3>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontSize: "18px",
              color: "#666",
            }}
          >
            ×
          </button>
        </div>
        {message.channels && (
          <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
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
      {renderThread(message)}
      <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #ddd" }}>
        <input
          type="text"
          placeholder="Type your reply..."
          style={{
            width: "100%",
            padding: "8px",
            border: "1px solid #ddd",
            borderRadius: "4px",
            fontSize: "14px",
          }}
        />
      </div>
    </div>
  );
};

export const Option2SplitPanel: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [selectedThread, setSelectedThread] = useState<Message | null>(null);

  const countReplies = (msg: Message): number => {
    if (!msg.replies) return 0;
    return msg.replies.length + msg.replies.reduce((acc, r) => acc + countReplies(r), 0);
  };

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1200px", margin: "0 auto", border: "1px solid #ddd" }}>
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {messages.map((message) => {
          const replyCount = countReplies(message);
          return (
            <div
              key={message.id}
              style={{
                padding: "12px",
                marginBottom: "8px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                cursor: replyCount > 0 ? "pointer" : "default",
                backgroundColor: selectedThread?.id === message.id ? "#f0f7ff" : "#fff",
              }}
              onClick={() => replyCount > 0 && setSelectedThread(message)}
            >
              <div style={{ fontSize: "13px" }}>
                <span style={{ fontWeight: 600 }}>{message.author}</span>
                <span style={{ color: "#666", marginLeft: "8px" }}>· {message.timestamp}</span>
              </div>
              <div style={{ fontSize: "14px", marginTop: "4px" }}>{message.content}</div>
              {replyCount > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                  💬 {replyCount} {replyCount === 1 ? "reply" : "replies"} · Last: {message.replies![message.replies!.length - 1].timestamp} →
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div style={{ width: "400px", backgroundColor: "#fafafa" }}>
        {selectedThread ? (
          <ThreadView message={selectedThread} onClose={() => setSelectedThread(null)} />
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#999" }}>
            Select a thread to view
          </div>
        )}
      </div>
    </div>
  );
};
