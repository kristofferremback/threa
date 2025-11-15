import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies } from "../data/graphMessages";

export const Option9ThreadHistory: React.FC = () => {
  const [history, setHistory] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);

  const rootMessages = getRootMessages();
  const currentId = currentIndex >= 0 ? history[currentIndex] : null;
  const currentMsg = currentId ? messageGraph[currentId] : null;
  const replies = currentId ? getReplies(currentId) : [];

  const navigateTo = (msgId: string) => {
    const newHistory = history.slice(0, currentIndex + 1);
    newHistory.push(msgId);
    setHistory(newHistory);
    setCurrentIndex(newHistory.length - 1);
  };

  const goBack = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const goForward = () => {
    if (currentIndex < history.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };

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
              backgroundColor: currentId === msg.id ? "#f0f7ff" : "#fff",
              cursor: "pointer",
            }}
            onClick={() => navigateTo(msg.id)}
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

      {/* Thread panel with history navigation */}
      <div style={{ width: "500px", backgroundColor: "#fafafa", display: "flex", flexDirection: "column" }}>
        {/* History navigation header */}
        <div
          style={{
            padding: "12px 16px",
            backgroundColor: "#fff",
            borderBottom: "1px solid #ddd",
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <button
            onClick={goBack}
            disabled={currentIndex <= 0}
            style={{
              padding: "6px 12px",
              fontSize: "18px",
              backgroundColor: "#fff",
              border: "1px solid #ddd",
              borderRadius: "4px",
              cursor: currentIndex > 0 ? "pointer" : "not-allowed",
              color: currentIndex > 0 ? "#333" : "#ccc",
            }}
          >
            ←
          </button>
          <button
            onClick={goForward}
            disabled={currentIndex >= history.length - 1}
            style={{
              padding: "6px 12px",
              fontSize: "18px",
              backgroundColor: "#fff",
              border: "1px solid #ddd",
              borderRadius: "4px",
              cursor: currentIndex < history.length - 1 ? "pointer" : "not-allowed",
              color: currentIndex < history.length - 1 ? "#333" : "#ccc",
            }}
          >
            →
          </button>
          <div style={{ flex: 1, fontSize: "12px", color: "#666" }}>
            {currentIndex >= 0 ? (
              <>
                {currentIndex + 1} of {history.length} in history
              </>
            ) : (
              "No thread selected"
            )}
          </div>
        </div>

        {/* History breadcrumb */}
        {history.length > 0 && (
          <div
            style={{
              padding: "8px 16px",
              backgroundColor: "#f9f9f9",
              borderBottom: "1px solid #ddd",
              overflowX: "auto",
              whiteSpace: "nowrap",
            }}
          >
            {history.map((id, idx) => {
              const msg = messageGraph[id];
              return (
                <React.Fragment key={id}>
                  <button
                    onClick={() => setCurrentIndex(idx)}
                    style={{
                      padding: "4px 8px",
                      fontSize: "11px",
                      backgroundColor: idx === currentIndex ? "#0066cc" : "#fff",
                      color: idx === currentIndex ? "#fff" : "#666",
                      border: "1px solid #ddd",
                      borderRadius: "3px",
                      cursor: "pointer",
                      marginRight: idx < history.length - 1 ? "6px" : 0,
                    }}
                  >
                    {msg?.author.slice(0, 1)}
                  </button>
                  {idx < history.length - 1 && (
                    <span style={{ margin: "0 6px", color: "#ccc" }}>→</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>
        )}

        {/* Thread content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
          {currentMsg ? (
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
                  <span style={{ fontWeight: 600 }}>{currentMsg.author}</span>
                  <span style={{ color: "#666", marginLeft: "8px" }}>· {currentMsg.timestamp}</span>
                </div>
                <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{currentMsg.content}</div>
                {currentMsg.parentId && (
                  <button
                    onClick={() => navigateTo(currentMsg.parentId!)}
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
                    ↑ Navigate to parent
                  </button>
                )}
              </div>

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
                        cursor: "pointer",
                      }}
                      onClick={() => navigateTo(reply.id)}
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
              Click a message to start navigating
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
