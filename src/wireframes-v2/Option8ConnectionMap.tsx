import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, countDescendants } from "../data/graphMessages";

export const Option8ConnectionMap: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const replies = selectedId ? getReplies(selectedId) : [];

  // Build connection map
  const buildMap = (msgId: string, depth = 0, maxDepth = 3): JSX.Element[] => {
    if (depth >= maxDepth) return [];
    const msg = messageGraph[msgId];
    if (!msg) return [];

    const elements: JSX.Element[] = [];
    const msgReplies = getReplies(msgId);

    elements.push(
      <div
        key={msg.id}
        onClick={() => setSelectedId(msg.id)}
        style={{
          display: "inline-block",
          padding: "4px 8px",
          margin: "2px",
          backgroundColor: selectedId === msg.id ? "#0066cc" : "#fff",
          color: selectedId === msg.id ? "#fff" : "#333",
          border: "1px solid #ddd",
          borderRadius: "3px",
          fontSize: "11px",
          cursor: "pointer",
        }}
        title={msg.content}
      >
        {msg.author}
      </div>
    );

    if (msgReplies.length > 0 && depth < maxDepth - 1) {
      elements.push(
        <div key={`${msg.id}-children`} style={{ marginLeft: "16px", marginTop: "4px" }}>
          {msgReplies.map((reply) => buildMap(reply.id, depth + 1, maxDepth))}
        </div>
      );
    }

    return elements;
  };

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd" }}>
      {/* Main feed */}
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => {
          const descendants = countDescendants(msg.id);
          return (
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
              {descendants > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                  🔗 {descendants} messages in thread
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Connection map panel */}
      <div style={{ width: "600px", display: "flex", flexDirection: "column" }}>
        {/* Mini map */}
        <div
          style={{
            height: "180px",
            borderBottom: "1px solid #ddd",
            backgroundColor: "#fafafa",
            padding: "16px",
            overflowY: "auto",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#666", marginBottom: "12px" }}>
            Connection Map
          </div>
          {selectedMsg ? (
            <div>{buildMap(selectedId!)}</div>
          ) : (
            <div style={{ fontSize: "13px", color: "#999" }}>Select a message to view map</div>
          )}
        </div>

        {/* Thread detail */}
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
                    ↑ Jump to parent
                  </button>
                )}
              </div>

              {replies.length > 0 && (
                <>
                  <h4 style={{ margin: "0 0 12px 0", fontSize: "14px", color: "#666" }}>
                    Direct Replies ({replies.length})
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
                          🔗 {countDescendants(reply.id)} in subthread
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
    </div>
  );
};
