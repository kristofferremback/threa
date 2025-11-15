import React from "react";
import { Message } from "../data/sampleMessages";

export const Option7StackedCards: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const renderMessage = (msg: Message, depth = 0) => {
    const shadowIntensity = Math.min(depth * 2, 8);
    const bgShade = 255 - depth * 5;

    return (
      <div
        key={msg.id}
        style={{
          padding: "12px",
          margin: depth > 0 ? "12px 0 0 16px" : "0 0 16px 0",
          backgroundColor: `rgb(${bgShade}, ${bgShade}, ${bgShade})`,
          border: `${1 + depth}px solid ${depth === 0 ? "#ddd" : "#ccc"}`,
          borderRadius: "6px",
          boxShadow: `0 ${shadowIntensity}px ${shadowIntensity * 2}px rgba(0,0,0,${0.05 + depth * 0.03})`,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "6px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
          <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
          {msg.channels && depth === 0 && (
            <div style={{ display: "flex", gap: "4px", marginLeft: "8px" }}>
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
        <div style={{ fontSize: "14px", lineHeight: "1.4", marginBottom: "8px" }}>
          {msg.content}
        </div>

        {msg.replies && msg.replies.length > 0 && (
          <div>
            {msg.replies.map((reply) => renderMessage(reply, depth + 1))}
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
      {messages.map((message) => renderMessage(message))}
    </div>
  );
};
