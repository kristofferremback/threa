import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

interface PanelState {
  id: string;
  messageId: string;
  width: number;
  minimized: boolean;
  pinned: boolean;
}

export const EnhancedStackedPanels: React.FC = () => {
  const [panels, setPanels] = useState<PanelState[]>([]);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rootMessages = getRootMessages();

  const openPanel = (msgId: string) => {
    // Don't open if already exists and not minimized
    const existing = panels.find((p) => p.messageId === msgId);
    if (existing && !existing.minimized) {
      return;
    }

    if (existing && existing.minimized) {
      // Restore minimized panel
      setPanels(
        panels.map((p) => (p.messageId === msgId ? { ...p, minimized: false } : p))
      );
    } else {
      // Create new panel
      const newPanel: PanelState = {
        id: `panel-${Date.now()}`,
        messageId: msgId,
        width: 380,
        minimized: false,
        pinned: false,
      };
      setPanels([...panels, newPanel]);
    }
  };

  const closePanel = (panelId: string) => {
    setPanels(panels.filter((p) => p.id !== panelId));
  };

  const minimizePanel = (panelId: string) => {
    setPanels(panels.map((p) => (p.id === panelId ? { ...p, minimized: true } : p)));
  };

  const togglePin = (panelId: string) => {
    setPanels(panels.map((p) => (p.id === panelId ? { ...p, pinned: !p.pinned } : p)));
  };

  const closeAllUnpinned = () => {
    setPanels(panels.filter((p) => p.pinned));
  };

  const renderThreadPanel = (panel: PanelState, index: number) => {
    const msg = messageGraph[panel.messageId];
    if (!msg) return null;

    const replies = getReplies(panel.messageId);

    if (panel.minimized) {
      return (
        <div
          key={panel.id}
          style={{
            width: "60px",
            borderRight: "1px solid #ddd",
            backgroundColor: "#f5f5f5",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: "12px 8px",
            flexShrink: 0,
            cursor: "pointer",
          }}
          onClick={() => openPanel(panel.messageId)}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "50%",
              backgroundColor: "#0066cc",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "16px",
              fontWeight: 600,
              marginBottom: "8px",
            }}
          >
            {msg.author.charAt(0)}
          </div>
          <div
            style={{
              fontSize: "10px",
              color: "#666",
              textAlign: "center",
              wordBreak: "break-word",
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
            }}
          >
            {msg.author}
          </div>
        </div>
      );
    }

    return (
      <div
        key={panel.id}
        style={{
          width: `${panel.width}px`,
          borderRight: "1px solid #ddd",
          backgroundColor: "#fafafa",
          display: "flex",
          flexDirection: "column",
          flexShrink: 0,
        }}
      >
        {/* Panel header */}
        <div
          style={{
            padding: "12px",
            backgroundColor: panel.pinned ? "#fff3cd" : "#fff",
            borderBottom: "2px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 600, color: "#666", flex: 1 }}>
            Thread {index + 1}
            {panel.pinned && " 📌"}
          </div>
          <div style={{ display: "flex", gap: "4px" }}>
            <button
              onClick={() => togglePin(panel.id)}
              title={panel.pinned ? "Unpin" : "Pin panel"}
              style={{
                border: "none",
                background: panel.pinned ? "#ffc107" : "transparent",
                cursor: "pointer",
                fontSize: "14px",
                padding: "2px 6px",
                borderRadius: "3px",
              }}
            >
              📌
            </button>
            <button
              onClick={() => minimizePanel(panel.id)}
              title="Minimize panel"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: "16px",
                color: "#666",
                padding: "2px 6px",
              }}
            >
              −
            </button>
            <button
              onClick={() => closePanel(panel.id)}
              title="Close panel"
              style={{
                border: "none",
                background: "none",
                cursor: "pointer",
                fontSize: "18px",
                color: "#666",
                padding: "2px 6px",
              }}
            >
              ×
            </button>
          </div>
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {/* Current message */}
          <div
            style={{
              padding: "16px",
              backgroundColor: "#e3f2fd",
              borderRadius: "6px",
              border: "2px solid #2196f3",
              marginBottom: "16px",
            }}
          >
            <div style={{ fontSize: "13px", marginBottom: "8px" }}>
              <span style={{ fontWeight: 600 }}>{msg.author}</span>
              <span style={{ color: "#666", marginLeft: "8px" }}>· {msg.timestamp}</span>
            </div>
            <div style={{ fontSize: "14px", lineHeight: "1.5" }}>{msg.content}</div>
            {msg.parentId && (
              <button
                onClick={() => openPanel(msg.parentId!)}
                style={{
                  marginTop: "12px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  backgroundColor: "#fff",
                  border: "2px solid #2196f3",
                  borderRadius: "4px",
                  cursor: "pointer",
                  color: "#2196f3",
                  fontWeight: 600,
                }}
              >
                ↑ Open parent
              </button>
            )}
          </div>

          {/* Replies */}
          {replies.length > 0 && (
            <>
              <div
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  color: "#666",
                  marginBottom: "12px",
                  textTransform: "uppercase",
                  letterSpacing: "0.5px",
                }}
              >
                Replies ({replies.length})
              </div>
              {replies.map((reply) => (
                <div
                  key={reply.id}
                  style={{
                    padding: "12px",
                    marginBottom: "10px",
                    backgroundColor: "#fff",
                    border: "2px solid #e0e0e0",
                    borderRadius: "6px",
                    cursor: reply.replyIds && reply.replyIds.length > 0 ? "pointer" : "default",
                    transition: "all 0.2s",
                  }}
                  onClick={() => reply.replyIds && reply.replyIds.length > 0 && openPanel(reply.id)}
                  onMouseEnter={(e) => {
                    if (reply.replyIds && reply.replyIds.length > 0) {
                      e.currentTarget.style.borderColor = "#2196f3";
                      e.currentTarget.style.backgroundColor = "#f5f5f5";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.backgroundColor = "#fff";
                  }}
                >
                  <div style={{ fontSize: "12px", marginBottom: "6px" }}>
                    <span style={{ fontWeight: 600 }}>{reply.author}</span>
                    <span style={{ color: "#666", marginLeft: "8px" }}>· {reply.timestamp}</span>
                  </div>
                  <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{reply.content}</div>
                  {reply.replyIds && reply.replyIds.length > 0 && (
                    <div
                      style={{
                        marginTop: "8px",
                        fontSize: "11px",
                        color: "#2196f3",
                        fontWeight: 600,
                      }}
                    >
                      💬 {reply.replyIds.length} →
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Reply input */}
          <input
            type="text"
            placeholder="Reply..."
            style={{
              width: "100%",
              padding: "10px",
              border: "2px solid #ddd",
              borderRadius: "6px",
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
          padding: "14px",
          marginBottom: "10px",
          border: isHovered ? "2px solid #2196f3" : "2px solid #e0e0e0",
          borderRadius: "6px",
          backgroundColor: "#fff",
          cursor: replyCount > 0 ? "pointer" : "default",
          position: "relative",
          transition: "all 0.2s",
        }}
        onMouseEnter={() => setHoveredId(msg.id)}
        onMouseLeave={() => setHoveredId(null)}
        onClick={() => replyCount > 0 && openPanel(msg.id)}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
          <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
        </div>
        <div style={{ marginTop: "8px", fontSize: "14px", lineHeight: "1.5" }}>
          {msg.content}
        </div>
        {replyCount > 0 && (
          <div style={{ marginTop: "10px", fontSize: "12px", color: "#2196f3", fontWeight: 600 }}>
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
              marginTop: "8px",
              padding: "12px",
              backgroundColor: "#fff",
              border: "2px solid #2196f3",
              borderRadius: "6px",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
              zIndex: 10,
            }}
          >
            {getReplies(msg.id)
              .slice(0, 2)
              .map((reply) => (
                <div key={reply.id} style={{ fontSize: "13px", marginBottom: "6px" }}>
                  <span style={{ fontWeight: 600 }}>{reply.author}:</span> {reply.content.slice(0, 50)}
                  {reply.content.length > 50 ? "..." : ""}
                </div>
              ))}
            <div style={{ marginTop: "8px", fontSize: "11px", color: "#2196f3", fontWeight: 600 }}>
              Click to open in panel →
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ maxWidth: "1400px", margin: "0 auto" }}>
      {/* Control bar */}
      {panels.length > 0 && (
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#f5f5f5",
            borderBottom: "1px solid #ddd",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: "13px", color: "#666" }}>
            {panels.filter((p) => !p.minimized).length} panel{panels.filter((p) => !p.minimized).length !== 1 ? "s" : ""} open
            {panels.filter((p) => p.minimized).length > 0 && ` · ${panels.filter((p) => p.minimized).length} minimized`}
          </div>
          <button
            onClick={closeAllUnpinned}
            style={{
              padding: "6px 12px",
              fontSize: "12px",
              backgroundColor: "#fff",
              border: "1px solid #ddd",
              borderRadius: "4px",
              cursor: "pointer",
            }}
          >
            Close all unpinned
          </button>
        </div>
      )}

      <div style={{ display: "flex", height: "600px", border: "1px solid #ddd", overflowX: "auto" }}>
        {/* Main feed */}
        <div
          style={{
            width: "400px",
            borderRight: "1px solid #ddd",
            overflowY: "auto",
            padding: "16px",
            flexShrink: 0,
            backgroundColor: "#fff",
          }}
        >
          <div
            style={{
              marginBottom: "16px",
              padding: "14px",
              backgroundColor: "#2196f3",
              color: "#fff",
              borderRadius: "6px",
            }}
          >
            <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>#engineering</h3>
          </div>
          {rootMessages.map((msg) => renderMessage(msg))}
        </div>

        {/* Stacked panels */}
        {panels.map((panel, index) => renderThreadPanel(panel, index))}

        {panels.length === 0 && (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#999",
              backgroundColor: "#fafafa",
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600 }}>No panels open</div>
            <div style={{ fontSize: "13px" }}>Click a message with replies to open a panel</div>
          </div>
        )}
      </div>
    </div>
  );
};
