import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

export const Option4GraphNavigator: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const replies = selectedId ? getReplies(selectedId) : [];

  // Build simple graph visualization data
  const getAllConnections = (msgId: string, depth = 0, maxDepth = 2): string[] => {
    if (depth >= maxDepth) return [];
    const msg = messageGraph[msgId];
    if (!msg) return [];

    const connections: string[] = [];
    if (msg.parentId) connections.push(msg.parentId);
    if (msg.replyIds) {
      connections.push(...msg.replyIds);
      msg.replyIds.forEach((rid) => {
        connections.push(...getAllConnections(rid, depth + 1, maxDepth));
      });
    }
    return connections;
  };

  const relatedMessages = selectedId ? [selectedId, ...getAllConnections(selectedId)] : [];

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd" }}>
      {/* Main feed */}
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => {
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
                cursor: "pointer",
                position: "relative",
              }}
              onMouseEnter={() => setHoveredId(msg.id)}
              onMouseLeave={() => setHoveredId(null)}
              onClick={() => setSelectedId(msg.id)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
                <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
              </div>
              <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.4" }}>
                {msg.content}
              </div>
              {replyCount > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                  💬 {replyCount}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Right side: Graph + Thread */}
      <div style={{ width: "600px", display: "flex", flexDirection: "column" }}>
        {/* Graph visualization */}
        <div
          style={{
            height: "200px",
            borderBottom: "1px solid #ddd",
            backgroundColor: "#fafafa",
            padding: "16px",
            overflowX: "auto",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "12px" }}>
            Thread Graph
          </div>
          {selectedMsg ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              {/* Parent */}
              {selectedMsg.parentId && (
                <>
                  <div
                    onClick={() => setSelectedId(selectedMsg.parentId!)}
                    style={{
                      padding: "6px 10px",
                      backgroundColor: "#fff",
                      border: "2px solid #999",
                      borderRadius: "4px",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    ↑ {messageGraph[selectedMsg.parentId].author}
                  </div>
                  <span style={{ fontSize: "16px", color: "#999" }}>→</span>
                </>
              )}

              {/* Current */}
              <div
                style={{
                  padding: "8px 12px",
                  backgroundColor: "#0066cc",
                  color: "#fff",
                  borderRadius: "4px",
                  fontSize: "12px",
                  fontWeight: 600,
                }}
              >
                {selectedMsg.author}
              </div>

              {/* Children */}
              {replies.length > 0 && (
                <>
                  <span style={{ fontSize: "16px", color: "#999" }}>→</span>
                  {replies.map((reply) => (
                    <div
                      key={reply.id}
                      onClick={() => setSelectedId(reply.id)}
                      style={{
                        padding: "6px 10px",
                        backgroundColor: "#fff",
                        border: "2px solid #0066cc",
                        borderRadius: "4px",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      {reply.author} ↓
                    </div>
                  ))}
                </>
              )}
            </div>
          ) : (
            <div style={{ color: "#999", fontSize: "13px" }}>Select a message to view graph</div>
          )}
        </div>

        {/* Thread panel */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#fff" }}>
          {selectedMsg ? (
            <>
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

              <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
                Replies ({replies.length})
              </h4>
              {replies.map((reply) => (
                <div
                  key={reply.id}
                  style={{
                    padding: "12px",
                    marginBottom: "8px",
                    backgroundColor: "#fafafa",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                  onClick={() => setSelectedId(reply.id)}
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
    </div>
  );
};
