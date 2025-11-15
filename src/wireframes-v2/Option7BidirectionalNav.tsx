import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

export const Option7BidirectionalNav: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parent = selectedMsg?.parentId ? messageGraph[selectedMsg.parentId] : null;
  const replies = selectedId ? getReplies(selectedId) : [];

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
              backgroundColor: selectedId === msg.id ? "#f0f7ff" : "#fff",
              cursor: "pointer",
            }}
            onClick={() => setSelectedId(msg.id)}
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

      {/* Bidirectional navigator panel */}
      <div style={{ width: "500px", backgroundColor: "#fafafa", display: "flex", flexDirection: "column" }}>
        {selectedMsg ? (
          <>
            {/* Navigation header */}
            <div
              style={{
                padding: "16px",
                backgroundColor: "#fff",
                borderBottom: "1px solid #ddd",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <button
                onClick={() => parent && setSelectedId(parent.id)}
                disabled={!parent}
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor: parent ? "#0066cc" : "#e0e0e0",
                  color: parent ? "#fff" : "#999",
                  border: "none",
                  borderRadius: "4px",
                  cursor: parent ? "pointer" : "not-allowed",
                }}
              >
                ↑ Up
              </button>
              <div style={{ fontSize: "12px", color: "#666", fontWeight: 600 }}>
                Navigate Thread
              </div>
              <button
                onClick={() => replies.length > 0 && setSelectedId(replies[0].id)}
                disabled={replies.length === 0}
                style={{
                  padding: "8px 16px",
                  fontSize: "13px",
                  fontWeight: 600,
                  backgroundColor: replies.length > 0 ? "#0066cc" : "#e0e0e0",
                  color: replies.length > 0 ? "#fff" : "#999",
                  border: "none",
                  borderRadius: "4px",
                  cursor: replies.length > 0 ? "pointer" : "not-allowed",
                }}
              >
                Down ↓
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              {/* Parent preview */}
              {parent && (
                <div style={{ marginBottom: "16px" }}>
                  <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>
                    ↑ Parent Message
                  </div>
                  <div
                    onClick={() => setSelectedId(parent.id)}
                    style={{
                      padding: "12px",
                      backgroundColor: "#fff",
                      border: "1px solid #999",
                      borderRadius: "4px",
                      cursor: "pointer",
                    }}
                  >
                    <div style={{ fontSize: "12px", marginBottom: "4px", color: "#666" }}>
                      {parent.author} · {parent.timestamp}
                    </div>
                    <div style={{ fontSize: "13px" }}>{parent.content}</div>
                  </div>
                </div>
              )}

              {/* Current message */}
              <div style={{ marginBottom: "16px" }}>
                <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>
                  • Current Message
                </div>
                <div
                  style={{
                    padding: "20px",
                    backgroundColor: "#0066cc",
                    color: "#fff",
                    borderRadius: "8px",
                  }}
                >
                  <div style={{ fontSize: "14px", marginBottom: "12px", opacity: 0.9 }}>
                    {selectedMsg.author} · {selectedMsg.timestamp}
                  </div>
                  <div style={{ fontSize: "16px", lineHeight: "1.5", fontWeight: 500 }}>
                    {selectedMsg.content}
                  </div>
                </div>
              </div>

              {/* Replies preview */}
              {replies.length > 0 && (
                <div>
                  <div style={{ fontSize: "11px", color: "#666", marginBottom: "6px", textTransform: "uppercase", fontWeight: 600 }}>
                    ↓ Replies ({replies.length})
                  </div>
                  {replies.map((reply) => (
                    <div
                      key={reply.id}
                      onClick={() => setSelectedId(reply.id)}
                      style={{
                        padding: "12px",
                        marginBottom: "8px",
                        backgroundColor: "#fff",
                        border: "1px solid #ddd",
                        borderRadius: "4px",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ fontSize: "12px", marginBottom: "4px", color: "#666" }}>
                        {reply.author} · {reply.timestamp}
                      </div>
                      <div style={{ fontSize: "13px" }}>{reply.content}</div>
                      {reply.replyIds && reply.replyIds.length > 0 && (
                        <div style={{ marginTop: "6px", fontSize: "11px", color: "#0066cc" }}>
                          → {reply.replyIds.length} more
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
                  marginTop: "16px",
                }}
              />
            </div>
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
            Select a message to navigate thread
          </div>
        )}
      </div>
    </div>
  );
};
