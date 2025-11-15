import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

export const Option6TimelineContext: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parentChain = selectedId ? getParentChain(selectedId) : [];
  const replies = selectedId ? getReplies(selectedId) : [];

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd" }}>
      {/* Timeline feed */}
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => (
          <div key={msg.id} style={{ marginBottom: "16px" }}>
            <div
              style={{
                display: "flex",
                gap: "16px",
                paddingBottom: "16px",
                borderBottom: "1px solid #eee",
              }}
            >
              <div
                style={{
                  fontSize: "12px",
                  color: "#666",
                  fontFamily: "monospace",
                  width: "60px",
                  flexShrink: 0,
                }}
              >
                {msg.timestamp}
              </div>
              <div
                style={{
                  flex: 1,
                  cursor: msg.replyIds && msg.replyIds.length > 0 ? "pointer" : "default",
                }}
                onClick={() => msg.replyIds && msg.replyIds.length > 0 && setSelectedId(msg.id)}
              >
                <div style={{ fontWeight: 600, fontSize: "14px", marginBottom: "4px" }}>
                  {msg.author}
                </div>
                <div style={{ fontSize: "14px", lineHeight: "1.4", marginBottom: "6px" }}>
                  {msg.content}
                </div>
                {msg.replyIds && msg.replyIds.length > 0 && (
                  <div style={{ fontSize: "12px", color: "#0066cc" }}>
                    💬 {msg.replyIds.length} {msg.replyIds.length === 1 ? "reply" : "replies"}
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Context panel */}
      <div style={{ width: "500px", backgroundColor: "#fafafa", overflowY: "auto", padding: "16px" }}>
        {selectedMsg ? (
          <>
            {/* Parent context */}
            {parentChain.length > 0 && (
              <div style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    fontSize: "12px",
                    color: "#666",
                    marginBottom: "8px",
                    fontWeight: 600,
                  }}
                >
                  Thread Context:
                </div>
                <div
                  style={{
                    padding: "12px",
                    backgroundColor: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                  }}
                >
                  {parentChain.map((parent, idx) => (
                    <div
                      key={parent.id}
                      onClick={() => setSelectedId(parent.id)}
                      style={{
                        padding: "8px",
                        marginBottom: idx < parentChain.length - 1 ? "8px" : 0,
                        backgroundColor: "#f9f9f9",
                        borderRadius: "3px",
                        cursor: "pointer",
                        fontSize: "13px",
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{parent.author}:</span> {parent.content}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current message */}
            <div
              style={{
                padding: "16px",
                backgroundColor: "#f0f7ff",
                borderRadius: "4px",
                border: "2px solid #0066cc",
                marginBottom: "16px",
              }}
            >
              <div style={{ fontSize: "13px", marginBottom: "8px" }}>
                <span style={{ fontWeight: 600 }}>{selectedMsg.author}</span>
                <span style={{ color: "#666", marginLeft: "8px" }}>· {selectedMsg.timestamp}</span>
              </div>
              <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{selectedMsg.content}</div>
              {selectedMsg.parentId && (
                <button
                  onClick={() => setSelectedId(selectedMsg.parentId!)}
                  style={{
                    marginTop: "12px",
                    padding: "6px 12px",
                    fontSize: "12px",
                    backgroundColor: "#fff",
                    border: "1px solid #0066cc",
                    borderRadius: "4px",
                    cursor: "pointer",
                    color: "#0066cc",
                  }}
                >
                  ↑ Open parent
                </button>
              )}
            </div>

            {/* Replies */}
            {replies.length > 0 && (
              <>
                <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
                  Replies ({replies.length})
                </h4>
                {replies.map((reply) => (
                  <div
                    key={reply.id}
                    style={{
                      padding: "12px",
                      marginBottom: "8px",
                      backgroundColor: "#fff",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                      cursor: reply.replyIds && reply.replyIds.length > 0 ? "pointer" : "default",
                    }}
                    onClick={() => reply.replyIds && reply.replyIds.length > 0 && setSelectedId(reply.id)}
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
              </>
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
            Select a message to view thread
          </div>
        )}
      </div>
    </div>
  );
};
