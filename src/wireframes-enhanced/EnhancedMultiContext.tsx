import React, { useState, useEffect, useRef } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

export const EnhancedMultiContext: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [parentContextHeight, setParentContextHeight] = useState<number>(200);
  const [isResizing, setIsResizing] = useState(false);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parentChain = selectedId ? getParentChain(selectedId) : [];
  const replies = selectedId ? getReplies(selectedId) : [];

  // Handle resize
  const handleMouseDown = () => setIsResizing(true);
  const handleMouseUp = () => setIsResizing(false);
  const handleMouseMove = (e: React.MouseEvent) => {
    if (isResizing) {
      setParentContextHeight(Math.max(100, Math.min(400, e.clientY - 60)));
    }
  };

  useEffect(() => {
    if (isResizing) {
      document.body.style.userSelect = "none";
      document.body.style.cursor = "row-resize";
    } else {
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    }
  }, [isResizing]);

  return (
    <div
      style={{
        display: "flex",
        height: "600px",
        maxWidth: "1400px",
        margin: "0 auto",
        border: "1px solid #ddd",
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Main feed */}
      <div
        style={{
          flex: 1,
          borderRight: "1px solid #ddd",
          overflowY: "auto",
          backgroundColor: "#fff",
        }}
      >
        <div
          style={{
            position: "sticky",
            top: 0,
            padding: "16px",
            backgroundColor: "#ff6f00",
            color: "#fff",
            zIndex: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>#engineering</h3>
          <div style={{ fontSize: "12px", opacity: 0.9, marginTop: "4px" }}>
            Multi-context view · Always see the full conversation
          </div>
        </div>

        <div style={{ padding: "16px" }}>
          {rootMessages.map((msg) => {
            const replyCount = msg.replyIds?.length || 0;
            const isSelected = selectedId === msg.id;

            return (
              <div
                key={msg.id}
                style={{
                  padding: "14px",
                  marginBottom: "10px",
                  border: isSelected ? "2px solid #ff6f00" : "2px solid #e0e0e0",
                  borderRadius: "8px",
                  backgroundColor: isSelected ? "#fff3e0" : "#fff",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
                onClick={() => setSelectedId(msg.id)}
                onMouseEnter={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = "#ff6f00";
                    e.currentTarget.style.backgroundColor = "#fafafa";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) {
                    e.currentTarget.style.borderColor = "#e0e0e0";
                    e.currentTarget.style.backgroundColor = "#fff";
                  }
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>{msg.author}</span>
                  <span style={{ color: "#666", fontSize: "12px" }}>· {msg.timestamp}</span>
                </div>
                <div style={{ marginTop: "8px", fontSize: "14px", lineHeight: "1.5" }}>
                  {msg.content}
                </div>
                {replyCount > 0 && (
                  <div
                    style={{
                      marginTop: "10px",
                      fontSize: "12px",
                      color: "#ff6f00",
                      fontWeight: 600,
                    }}
                  >
                    💬 {replyCount}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Context panel */}
      <div
        style={{
          width: "600px",
          display: "flex",
          flexDirection: "column",
          backgroundColor: "#fafafa",
        }}
      >
        {selectedMsg ? (
          <>
            {/* Parent context - always visible, resizable */}
            {parentChain.length > 0 && (
              <>
                <div
                  style={{
                    height: `${parentContextHeight}px`,
                    borderBottom: "1px solid #ddd",
                    backgroundColor: "#fff8e1",
                    display: "flex",
                    flexDirection: "column",
                  }}
                >
                  <div
                    style={{
                      padding: "12px 16px",
                      backgroundColor: "#ffc107",
                      borderBottom: "1px solid #ddd",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        fontWeight: 700,
                        color: "#000",
                        textTransform: "uppercase",
                        letterSpacing: "0.5px",
                      }}
                    >
                      ↑ Parent Context ({parentChain.length} messages)
                    </div>
                    <div style={{ fontSize: "10px", opacity: 0.7, marginTop: "2px" }}>
                      Full conversation history leading to current message
                    </div>
                  </div>

                  <div style={{ flex: 1, overflowY: "auto", padding: "12px" }}>
                    {parentChain.map((parent, idx) => {
                      const isLast = idx === parentChain.length - 1;
                      return (
                        <div key={parent.id} style={{ position: "relative" }}>
                          {/* Connection line */}
                          {!isLast && (
                            <div
                              style={{
                                position: "absolute",
                                left: "16px",
                                top: "48px",
                                bottom: "-12px",
                                width: "2px",
                                backgroundColor: "#ffc107",
                              }}
                            />
                          )}

                          <div
                            onClick={() => setSelectedId(parent.id)}
                            style={{
                              position: "relative",
                              padding: "12px 12px 12px 40px",
                              marginBottom: "12px",
                              backgroundColor: "#fff",
                              border: "2px solid #ffe082",
                              borderRadius: "6px",
                              cursor: "pointer",
                              transition: "all 0.2s",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = "#ffc107";
                              e.currentTarget.style.backgroundColor = "#fffde7";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = "#ffe082";
                              e.currentTarget.style.backgroundColor = "#fff";
                            }}
                          >
                            {/* Step number */}
                            <div
                              style={{
                                position: "absolute",
                                left: "8px",
                                top: "12px",
                                width: "20px",
                                height: "20px",
                                borderRadius: "50%",
                                backgroundColor: "#ffc107",
                                color: "#000",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "10px",
                                fontWeight: 700,
                              }}
                            >
                              {idx + 1}
                            </div>

                            <div
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                marginBottom: "4px",
                              }}
                            >
                              <span style={{ fontWeight: 600, fontSize: "13px" }}>
                                {parent.author}
                              </span>
                              <span style={{ color: "#999", fontSize: "11px" }}>
                                · {parent.timestamp}
                              </span>
                            </div>
                            <div
                              style={{
                                fontSize: "13px",
                                color: "#333",
                                lineHeight: "1.4",
                              }}
                            >
                              {parent.content}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Resize handle */}
                <div
                  onMouseDown={handleMouseDown}
                  style={{
                    height: "4px",
                    backgroundColor: isResizing ? "#ffc107" : "#ddd",
                    cursor: "row-resize",
                    transition: "background-color 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor = "#ffc107";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isResizing) {
                      e.currentTarget.style.backgroundColor = "#ddd";
                    }
                  }}
                />
              </>
            )}

            {/* Current message + replies */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px", backgroundColor: "#fff" }}>
              {/* Current message - highlighted */}
              <div
                style={{
                  padding: "20px",
                  backgroundColor: "#fff3e0",
                  borderRadius: "10px",
                  border: "4px solid #ff6f00",
                  marginBottom: "20px",
                  position: "relative",
                }}
              >
                {/* Corner badge */}
                <div
                  style={{
                    position: "absolute",
                    top: "-12px",
                    left: "16px",
                    backgroundColor: "#ff6f00",
                    color: "#fff",
                    padding: "4px 12px",
                    borderRadius: "4px",
                    fontSize: "10px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Current Message
                </div>

                <div style={{ fontSize: "14px", marginBottom: "10px", marginTop: "8px" }}>
                  <span style={{ fontWeight: 700, fontSize: "16px" }}>
                    {selectedMsg.author}
                  </span>
                  <span style={{ color: "#666", marginLeft: "10px", fontSize: "13px" }}>
                    · {selectedMsg.timestamp}
                  </span>
                </div>
                <div
                  style={{
                    fontSize: "16px",
                    lineHeight: "1.6",
                    color: "#333",
                    fontWeight: 500,
                  }}
                >
                  {selectedMsg.content}
                </div>

                {/* Action buttons */}
                <div style={{ marginTop: "16px", display: "flex", gap: "8px" }}>
                  {selectedMsg.parentId && (
                    <button
                      onClick={() => setSelectedId(selectedMsg.parentId!)}
                      style={{
                        padding: "8px 16px",
                        fontSize: "12px",
                        backgroundColor: "#ff6f00",
                        color: "#fff",
                        border: "none",
                        borderRadius: "6px",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      ↑ Jump to parent
                    </button>
                  )}
                  <button
                    style={{
                      padding: "8px 16px",
                      fontSize: "12px",
                      backgroundColor: "#fff",
                      color: "#ff6f00",
                      border: "2px solid #ff6f00",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Reply
                  </button>
                </div>
              </div>

              {/* Replies section */}
              {replies.length > 0 && (
                <>
                  <div
                    style={{
                      fontSize: "12px",
                      fontWeight: 700,
                      color: "#666",
                      marginBottom: "14px",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                      display: "flex",
                      alignItems: "center",
                      gap: "8px",
                    }}
                  >
                    <span>↓ Replies ({replies.length})</span>
                    <div
                      style={{
                        flex: 1,
                        height: "2px",
                        backgroundColor: "#e0e0e0",
                      }}
                    />
                  </div>

                  {replies.map((reply, idx) => (
                    <div
                      key={reply.id}
                      style={{
                        padding: "16px",
                        marginBottom: "12px",
                        backgroundColor: "#fafafa",
                        border: "2px solid #e0e0e0",
                        borderRadius: "8px",
                        cursor:
                          reply.replyIds && reply.replyIds.length > 0 ? "pointer" : "default",
                        transition: "all 0.2s",
                        position: "relative",
                      }}
                      onClick={() =>
                        reply.replyIds && reply.replyIds.length > 0 && setSelectedId(reply.id)
                      }
                      onMouseEnter={(e) => {
                        if (reply.replyIds && reply.replyIds.length > 0) {
                          e.currentTarget.style.borderColor = "#ff6f00";
                          e.currentTarget.style.backgroundColor = "#fff";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#e0e0e0";
                        e.currentTarget.style.backgroundColor = "#fafafa";
                      }}
                    >
                      {/* Reply number */}
                      <div
                        style={{
                          position: "absolute",
                          top: "-8px",
                          left: "12px",
                          backgroundColor: "#ff6f00",
                          color: "#fff",
                          width: "20px",
                          height: "20px",
                          borderRadius: "50%",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "10px",
                          fontWeight: 700,
                        }}
                      >
                        {idx + 1}
                      </div>

                      <div style={{ fontSize: "13px", marginBottom: "8px" }}>
                        <span style={{ fontWeight: 600 }}>{reply.author}</span>
                        <span style={{ color: "#666", marginLeft: "8px" }}>
                          · {reply.timestamp}
                        </span>
                      </div>
                      <div style={{ fontSize: "14px", lineHeight: "1.5" }}>{reply.content}</div>
                      {reply.replyIds && reply.replyIds.length > 0 && (
                        <div
                          style={{
                            marginTop: "10px",
                            padding: "6px 10px",
                            backgroundColor: "#fff3e0",
                            borderRadius: "4px",
                            display: "inline-block",
                            fontSize: "11px",
                            color: "#ff6f00",
                            fontWeight: 700,
                          }}
                        >
                          💬 {reply.replyIds.length}{" "}
                          {reply.replyIds.length === 1 ? "reply" : "replies"} · Click to view
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {replies.length === 0 && (
                <div
                  style={{
                    padding: "32px",
                    textAlign: "center",
                    color: "#999",
                    backgroundColor: "#fafafa",
                    borderRadius: "8px",
                    border: "2px dashed #e0e0e0",
                  }}
                >
                  <div style={{ fontSize: "14px", marginBottom: "8px" }}>No replies yet</div>
                  <div style={{ fontSize: "12px" }}>Be the first to reply to this message</div>
                </div>
              )}

              {/* Reply input */}
              <input
                type="text"
                placeholder="Write your reply..."
                style={{
                  width: "100%",
                  padding: "14px",
                  border: "2px solid #ddd",
                  borderRadius: "8px",
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
              flexDirection: "column",
              gap: "12px",
            }}
          >
            <div style={{ fontSize: "16px", fontWeight: 600 }}>No message selected</div>
            <div style={{ fontSize: "13px", textAlign: "center", maxWidth: "300px" }}>
              Click a message to view it with full parent context
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
