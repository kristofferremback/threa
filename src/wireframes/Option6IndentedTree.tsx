import React from "react";
import { Message } from "../data/sampleMessages";

export const Option6IndentedTree: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const renderMessage = (msg: Message, depth = 0, isLast = false, parentLines: boolean[] = []) => {
    const hasReplies = msg.replies && msg.replies.length > 0;

    return (
      <div key={msg.id}>
        <div style={{ display: "flex", alignItems: "flex-start", marginBottom: "8px" }}>
          {/* Tree connectors */}
          <div style={{ display: "flex", alignItems: "flex-start", minWidth: `${depth * 24}px` }}>
            {parentLines.map((hasLine, i) => (
              <div key={i} style={{ width: "24px", position: "relative" }}>
                {hasLine && (
                  <div
                    style={{
                      position: "absolute",
                      left: "11px",
                      top: 0,
                      bottom: 0,
                      width: "1px",
                      backgroundColor: "#ccc",
                    }}
                  />
                )}
              </div>
            ))}
            {depth > 0 && (
              <div style={{ width: "24px", position: "relative" }}>
                <div
                  style={{
                    position: "absolute",
                    left: "11px",
                    top: 0,
                    height: "16px",
                    width: "1px",
                    backgroundColor: "#ccc",
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: "11px",
                    top: "16px",
                    width: "8px",
                    height: "1px",
                    backgroundColor: "#ccc",
                  }}
                />
                {!isLast && (
                  <div
                    style={{
                      position: "absolute",
                      left: "11px",
                      top: "16px",
                      bottom: "-8px",
                      width: "1px",
                      backgroundColor: "#ccc",
                    }}
                  />
                )}
                <div
                  style={{
                    position: "absolute",
                    left: "19px",
                    top: "13px",
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: "#0066cc",
                  }}
                />
              </div>
            )}
          </div>

          {/* Message content */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
              <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
              <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
              {msg.channels && (
                <div style={{ display: "flex", gap: "4px" }}>
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
            <div style={{ fontSize: "14px", lineHeight: "1.4", marginBottom: "4px" }}>
              {msg.content}
            </div>
            <button
              style={{
                padding: "4px 8px",
                fontSize: "11px",
                backgroundColor: "transparent",
                color: "#0066cc",
                border: "1px solid transparent",
                borderRadius: "3px",
                cursor: "pointer",
                marginTop: "4px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "#0066cc";
                e.currentTarget.style.backgroundColor = "#f0f7ff";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "transparent";
                e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              Reply
            </button>
          </div>
        </div>

        {/* Render replies */}
        {hasReplies && (
          <div>
            {msg.replies!.map((reply, index) =>
              renderMessage(
                reply,
                depth + 1,
                index === msg.replies!.length - 1,
                [...parentLines, !isLast]
              )
            )}
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
      <div style={{ fontFamily: "monospace" }}>
        {messages.map((message, index) => renderMessage(message, 0, index === messages.length - 1))}
      </div>
    </div>
  );
};
