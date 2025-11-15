import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

export const Option5FocusMode: React.FC = () => {
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const focusedMsg = focusedId ? messageGraph[focusedId] : null;
  const parent = focusedMsg?.parentId ? messageGraph[focusedMsg.parentId] : null;
  const replies = focusedId ? getReplies(focusedId) : [];
  const siblings = parent ? getReplies(parent.id).filter((r) => r.id !== focusedId) : [];

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd" }}>
      {/* Main feed */}
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => (
          <div
            key={msg.id}
            style={{
              padding: "12px",
              marginBottom: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
              backgroundColor: focusedId === msg.id ? "#f0f7ff" : "#fff",
              cursor: "pointer",
            }}
            onClick={() => setFocusedId(msg.id)}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
              <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
            </div>
            <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.4" }}>
              {msg.content}
            </div>
            {msg.replyIds && msg.replyIds.length > 0 && (
              <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                💬 {msg.replyIds.length}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Focus panel */}
      <div style={{ width: "600px", backgroundColor: "#fafafa", overflowY: "auto", padding: "16px" }}>
        {focusedMsg ? (
          <>
            {/* Parent context */}
            {parent && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>↑ Parent:</div>
                <div
                  onClick={() => setFocusedId(parent.id)}
                  style={{
                    padding: "12px",
                    backgroundColor: "#fff",
                    border: "1px solid #999",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ fontSize: "13px", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 600 }}>{parent.author}</span>
                    <span style={{ color: "#666", marginLeft: "8px" }}>· {parent.timestamp}</span>
                  </div>
                  <div style={{ fontSize: "13px", color: "#666" }}>{parent.content}</div>
                </div>
              </div>
            )}

            {/* Focused message */}
            <div
              style={{
                padding: "20px",
                backgroundColor: "#0066cc",
                color: "#fff",
                borderRadius: "8px",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "14px", marginBottom: "12px", opacity: 0.9 }}>
                <span style={{ fontWeight: 600 }}>{focusedMsg.author}</span>
                <span style={{ marginLeft: "8px" }}>· {focusedMsg.timestamp}</span>
              </div>
              <div style={{ fontSize: "16px", lineHeight: "1.5", fontWeight: 500 }}>
                {focusedMsg.content}
              </div>
            </div>

            {/* Siblings */}
            {siblings.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
                  ↔ Sibling replies ({siblings.length}):
                </div>
                {siblings.map((sibling) => (
                  <div
                    key={sibling.id}
                    onClick={() => setFocusedId(sibling.id)}
                    style={{
                      padding: "10px",
                      marginBottom: "6px",
                      backgroundColor: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                      fontSize: "13px",
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{sibling.author}:</span> {sibling.content.slice(0, 50)}...
                  </div>
                ))}
              </div>
            )}

            {/* Replies */}
            {replies.length > 0 && (
              <div>
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
                  ↓ Replies ({replies.length}):
                </div>
                {replies.map((reply) => (
                  <div
                    key={reply.id}
                    onClick={() => setFocusedId(reply.id)}
                    style={{
                      padding: "12px",
                      marginBottom: "8px",
                      backgroundColor: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: "13px", marginBottom: "4px" }}>
                      <span style={{ fontWeight: 600 }}>{reply.author}</span>
                      <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
                    </div>
                    <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{reply.content}</div>
                    {reply.replyIds && reply.replyIds.length > 0 && (
                      <div style={{ marginTop: "6px", fontSize: "12px", color: "#0066cc" }}>
                        💬 {reply.replyIds.length}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <input
              type="text"
              placeholder="Reply..."
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                fontSize: "14px",
                marginTop: "12px",
              }}
            />
          </>
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#999",
            }}
          >
            Select a message to focus
          </div>
        )}
      </div>
    </div>
  );
};
