import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

export const Option1SingleThreadPanel: React.FC = () => {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parentChain = selectedId ? getParentChain(selectedId) : [];
  const replies = selectedId ? getReplies(selectedId) : [];

  const renderMessage = (msg: GraphMessage, isInFeed = true) => {
    const replyCount = msg.replyIds?.length || 0;
    const isHovered = hoveredId === msg.id;

    return (
      <div
        key={msg.id}
        style={{
          padding: "12px",
          marginBottom: "8px",
          border: isHovered ? "2px solid #0066cc" : "1px solid #ddd",
          borderRadius: "4px",
          backgroundColor: selectedId === msg.id ? "#f0f7ff" : "#fff",
          cursor: replyCount > 0 ? "pointer" : "default",
          position: "relative",
        }}
        onMouseEnter={() => setHoveredId(msg.id)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => replyCount > 0 && setSelectedId(msg.id)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
          <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
          {msg.channels && isInFeed && (
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
        <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.4" }}>
          {msg.content}
        </div>
        {replyCount > 0 && (
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
            💬 {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </div>
        )}

        {/* Hover preview */}
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
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px", color: "#666" }}>
              Preview:
            </div>
            {getReplies(msg.id).slice(0, 3).map((reply) => (
              <div key={reply.id} style={{ fontSize: "13px", marginBottom: "6px", color: "#333" }}>
                <span style={{ fontWeight: 600 }}>{reply.author}:</span> {reply.content.slice(0, 60)}
                {reply.content.length > 60 ? "..." : ""}
              </div>
            ))}
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
              Click to view full thread →
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd" }}>
      {/* Main feed */}
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => renderMessage(msg))}
      </div>

      {/* Thread panel */}
      <div style={{ width: "500px", backgroundColor: "#fafafa", overflowY: "auto" }}>
        {selectedMsg ? (
          <div style={{ padding: "16px" }}>
            {/* Breadcrumb navigation */}
            {parentChain.length > 0 && (
              <div
                style={{
                  marginBottom: "16px",
                  padding: "12px",
                  backgroundColor: "#fff",
                  borderRadius: "4px",
                  border: "1px solid #ddd",
                }}
              >
                <div style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>Thread context:</div>
                <div style={{ display: "flex", alignItems: "center", gap: "6px", flexWrap: "wrap" }}>
                  {parentChain.map((parent, idx) => (
                    <React.Fragment key={parent.id}>
                      <button
                        onClick={() => setSelectedId(parent.id)}
                        style={{
                          padding: "4px 8px",
                          fontSize: "12px",
                          backgroundColor: "#fff",
                          border: "1px solid #0066cc",
                          borderRadius: "3px",
                          cursor: "pointer",
                          color: "#0066cc",
                        }}
                      >
                        {parent.author}: {parent.content.slice(0, 20)}...
                      </button>
                      {idx < parentChain.length - 1 && <span style={{ color: "#999" }}>→</span>}
                    </React.Fragment>
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
            <div style={{ marginBottom: "16px" }}>
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
                    <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                      💬 {reply.replyIds.length} {reply.replyIds.length === 1 ? "reply" : "replies"} →
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Reply input */}
            <div>
              <input
                type="text"
                placeholder="Reply..."
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
            Select a message with replies to view thread
          </div>
        )}
      </div>
    </div>
  );
};
