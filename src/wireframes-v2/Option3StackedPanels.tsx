import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

export const Option3StackedPanels: React.FC = () => {
  const [panelStack, setPanelStack] = useState<string[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rootMessages = getRootMessages();

  const openPanel = (msgId: string) => {
    if (!panelStack.includes(msgId)) {
      setPanelStack([...panelStack, msgId]);
    }
  };

  const closePanel = (msgId: string) => {
    setPanelStack(panelStack.filter((id) => id !== msgId));
  };

  const renderThreadPanel = (msgId: string, index: number) => {
    const msg = messageGraph[msgId];
    if (!msg) return null;

    const replies = getReplies(msgId);

    return (
      <div
        key={msgId}
        style={{
          width: "350px",
          borderRight: "1px solid #ddd",
          backgroundColor: "#fafafa",
          overflowY: "auto",
          flexShrink: 0,
        }}
      >
        <div
          style={{
            padding: "12px",
            backgroundColor: "#fff",
            borderBottom: "1px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 600, color: "#666" }}>Thread {index + 1}</div>
          <button
            onClick={() => closePanel(msgId)}
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

        <div style={{ padding: "16px" }}>
          {/* Current message */}
          <div
            style={{
              padding: "12px",
              backgroundColor: "#f0f7ff",
              borderRadius: "4px",
              border: "2px solid #0066cc",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "13px", marginBottom: "8px" }}>
              <span style={{ fontWeight: 600 }}>{msg.author}</span>
              <span style={{ color: "#666", marginLeft: "8px" }}>· {msg.timestamp}</span>
            </div>
            <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{msg.content}</div>
            {msg.parentId && (
              <button
                onClick={() => openPanel(msg.parentId!)}
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
                    padding: "10px",
                    marginBottom: "8px",
                    backgroundColor: "#fff",
                    border: "1px solid #ddd",
                    borderRadius: "4px",
                    cursor: reply.replyIds && reply.replyIds.length > 0 ? "pointer" : "default",
                  }}
                  onClick={() => reply.replyIds && reply.replyIds.length > 0 && openPanel(reply.id)}
                >
                  <div style={{ fontSize: "13px", marginBottom: "4px" }}>
                    <span style={{ fontWeight: 600 }}>{reply.author}</span>
                    <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
                  </div>
                  <div style={{ fontSize: "13px", lineHeight: "1.4" }}>{reply.content}</div>
                  {reply.replyIds && reply.replyIds.length > 0 && (
                    <div style={{ marginTop: "6px", fontSize: "11px", color: "#0066cc" }}>
                      💬 {reply.replyIds.length} →
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
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
              fontSize: "13px",
              marginTop: "12px",
            }}
          />
        </div>
      </div>
    );
  };

  const renderMessage = (msg: GraphMessage) => {
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
          backgroundColor: "#fff",
          cursor: replyCount > 0 ? "pointer" : "default",
          position: "relative",
        }}
        onMouseEnter={() => setHoveredId(msg.id)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => replyCount > 0 && openPanel(msg.id)}
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
            💬 {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </div>
        )}

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
          >
            {getReplies(msg.id).slice(0, 2).map((reply) => (
              <div key={reply.id} style={{ fontSize: "13px", marginBottom: "6px" }}>
                <span style={{ fontWeight: 600 }}>{reply.author}:</span> {reply.content.slice(0, 40)}...
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1400px", margin: "0 auto", border: "1px solid #ddd", overflowX: "auto" }}>
      {/* Main feed */}
      <div style={{ width: "400px", borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px", flexShrink: 0 }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>
        {rootMessages.map((msg) => renderMessage(msg))}
      </div>

      {/* Stacked thread panels */}
      {panelStack.map((msgId, index) => renderThreadPanel(msgId, index))}

      {panelStack.length === 0 && (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#999",
            backgroundColor: "#fafafa",
          }}
        >
          Click a message to open thread panel
        </div>
      )}
    </div>
  );
};
