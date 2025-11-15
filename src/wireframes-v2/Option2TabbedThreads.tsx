import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

interface ThreadTab {
  id: string;
  messageId: string;
  title: string;
}

export const Option2TabbedThreads: React.FC = () => {
  const [openTabs, setOpenTabs] = useState<ThreadTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const rootMessages = getRootMessages();

  const openThread = (msg: GraphMessage) => {
    const tabId = `tab-${msg.id}`;
    const existingTab = openTabs.find((t) => t.messageId === msg.id);

    if (!existingTab) {
      const newTab: ThreadTab = {
        id: tabId,
        messageId: msg.id,
        title: `${msg.author}: ${msg.content.slice(0, 20)}...`,
      };
      setOpenTabs([...openTabs, newTab]);
      setActiveTabId(tabId);
    } else {
      setActiveTabId(existingTab.id);
    }
  };

  const closeTab = (tabId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const newTabs = openTabs.filter((t) => t.id !== tabId);
    setOpenTabs(newTabs);
    if (activeTabId === tabId) {
      setActiveTabId(newTabs.length > 0 ? newTabs[newTabs.length - 1].id : null);
    }
  };

  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const activeMessage = activeTab ? messageGraph[activeTab.messageId] : null;
  const replies = activeMessage ? getReplies(activeMessage.id) : [];

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
        onClick={() => replyCount > 0 && openThread(msg)}
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
          >
            {getReplies(msg.id).slice(0, 2).map((reply) => (
              <div key={reply.id} style={{ fontSize: "13px", marginBottom: "6px", color: "#333" }}>
                <span style={{ fontWeight: 600 }}>{reply.author}:</span> {reply.content.slice(0, 50)}...
              </div>
            ))}
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

      {/* Tabbed thread panel */}
      <div style={{ width: "500px", backgroundColor: "#fafafa", display: "flex", flexDirection: "column" }}>
        {/* Tab bar */}
        {openTabs.length > 0 && (
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid #ddd",
              backgroundColor: "#fff",
              overflowX: "auto",
            }}
          >
            {openTabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => setActiveTabId(tab.id)}
                style={{
                  padding: "8px 12px",
                  fontSize: "12px",
                  backgroundColor: activeTabId === tab.id ? "#f0f7ff" : "#fff",
                  borderRight: "1px solid #ddd",
                  cursor: "pointer",
                  minWidth: "150px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  borderTop: activeTabId === tab.id ? "2px solid #0066cc" : "2px solid transparent",
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                  }}
                >
                  {tab.title}
                </span>
                <button
                  onClick={(e) => closeTab(tab.id, e)}
                  style={{
                    marginLeft: "8px",
                    border: "none",
                    background: "none",
                    cursor: "pointer",
                    fontSize: "14px",
                    color: "#666",
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Active thread content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {activeMessage ? (
            <>
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
                  <span style={{ fontWeight: 600 }}>{activeMessage.author}</span>
                  <span style={{ color: "#666", marginLeft: "8px" }}>· {activeMessage.timestamp}</span>
                </div>
                <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{activeMessage.content}</div>
                {activeMessage.parentId && (
                  <button
                    onClick={() => openThread(messageGraph[activeMessage.parentId!])}
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
                    ↑ Open parent in new tab
                  </button>
                )}
              </div>

              {/* Replies */}
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
                  onClick={() => reply.replyIds && reply.replyIds.length > 0 && openThread(reply)}
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
              Click a message to open thread in new tab
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
