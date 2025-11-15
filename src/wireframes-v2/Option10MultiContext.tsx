import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

export const Option10MultiContext: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parentChain = selectedId ? getParentChain(selectedId) : [];
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

      {/* Multi-context panel */}
      <div style={{ width: "600px", display: "flex", flexDirection: "column" }}>
        {/* Parent context - always visible */}
        {parentChain.length > 0 && (
          <div
            style={{
              maxHeight: "200px",
              borderBottom: "1px solid #ddd",
              backgroundColor: "#f9f9f9",
              padding: "12px",
              overflowY: "auto",
            }}
          >
            <div
              style={{
                fontSize: "11px",
                color: "#666",
                marginBottom: "8px",
                fontWeight: 600,
                textTransform: "uppercase",
              }}
            >
              Parent Context ({parentChain.length} messages)
            </div>
            {parentChain.map((parent, idx) => (
              <div
                key={parent.id}
                onClick={() => setSelectedId(parent.id)}
                style={{
                  padding: "8px 10px",
                  marginBottom: "6px",
                  backgroundColor: "#fff",
                  border: "1px solid #ddd",
                  borderRadius: "3px",
                  cursor: "pointer",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3px" }}>
                  <span style={{ color: "#999" }}>{idx + 1}.</span>
                  <span style={{ fontWeight: 600 }}>{parent.author}</span>
                  <span style={{ color: "#999" }}>·</span>
                  <span style={{ color: "#666" }}>{parent.timestamp}</span>
                </div>
                <div style={{ color: "#666", fontSize: "11px" }}>
                  {parent.content.slice(0, 60)}...
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Current message */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#fff" }}>
          {selectedMsg ? (
            <>
              <div
                style={{
                  padding: "20px",
                  backgroundColor: "#f0f7ff",
                  borderRadius: "8px",
                  border: "3px solid #0066cc",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#0066cc",
                    marginBottom: "8px",
                    fontWeight: 600,
                    textTransform: "uppercase",
                  }}
                >
                  Current Message
                </div>
                <div style={{ fontSize: "14px", marginBottom: "10px" }}>
                  <span style={{ fontWeight: 600 }}>{selectedMsg.author}</span>
                  <span style={{ color: "#666", marginLeft: "8px" }}>· {selectedMsg.timestamp}</span>
                </div>
                <div style={{ fontSize: "16px", lineHeight: "1.5", fontWeight: 500 }}>
                  {selectedMsg.content}
                </div>
                {selectedMsg.parentId && (
                  <button
                    onClick={() => setSelectedId(selectedMsg.parentId!)}
                    style={{
                      marginTop: "14px",
                      padding: "8px 14px",
                      fontSize: "12px",
                      backgroundColor: "#fff",
                      border: "2px solid #0066cc",
                      borderRadius: "4px",
                      cursor: "pointer",
                      color: "#0066cc",
                      fontWeight: 600,
                    }}
                  >
                    ↑ Jump to parent
                  </button>
                )}
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <>
                  <h4
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "13px",
                      color: "#666",
                      fontWeight: 600,
                      textTransform: "uppercase",
                    }}
                  >
                    Replies ({replies.length})
                  </h4>
                  {replies.map((reply) => (
                    <div
                      key={reply.id}
                      style={{
                        padding: "14px",
                        marginBottom: "10px",
                        backgroundColor: "#fafafa",
                        border: "2px solid #e0e0e0",
                        borderRadius: "6px",
                        cursor: "pointer",
                      }}
                      onClick={() => setSelectedId(reply.id)}
                    >
                      <div style={{ fontSize: "13px", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600 }}>{reply.author}</span>
                        <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
                      </div>
                      <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{reply.content}</div>
                      {reply.replyIds && reply.replyIds.length > 0 && (
                        <div
                          style={{
                            marginTop: "8px",
                            padding: "4px 8px",
                            backgroundColor: "#e6f2ff",
                            borderRadius: "3px",
                            display: "inline-block",
                            fontSize: "11px",
                            color: "#0066cc",
                            fontWeight: 600,
                          }}
                        >
                          💬 {reply.replyIds.length} {reply.replyIds.length === 1 ? "reply" : "replies"}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              <input
                type="text"
                placeholder="Reply to this message..."
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "2px solid #ddd",
                  borderRadius: "6px",
                  fontSize: "14px",
                  marginTop: "16px",
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
              Select a message to view thread with context
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
