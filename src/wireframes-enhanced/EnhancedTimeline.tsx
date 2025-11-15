import React, { useState } from "react";
import { GraphMessage, messageGraph, getRootMessages, getReplies, getParentChain } from "../data/graphMessages";

export const EnhancedTimeline: React.FC = () => {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextCollapsed, setContextCollapsed] = useState(false);
  const [hoveredContextId, setHoveredContextId] = useState<string | null>(null);

  const rootMessages = getRootMessages();
  const selectedMsg = selectedId ? messageGraph[selectedId] : null;
  const parentChain = selectedId ? getParentChain(selectedId) : [];
  const replies = selectedId ? getReplies(selectedId) : [];

  return (
    <div
      style={{
        display: "flex",
        height: "600px",
        maxWidth: "1400px",
        margin: "0 auto",
        border: "1px solid #ddd",
      }}
    >
      {/* Timeline feed */}
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
            backgroundColor: "#673ab7",
            color: "#fff",
            zIndex: 10,
          }}
        >
          <h3 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>#engineering</h3>
          <div style={{ fontSize: "12px", opacity: 0.9, marginTop: "4px" }}>
            Timeline view · {rootMessages.length} messages
          </div>
        </div>

        <div style={{ padding: "0 16px 16px 16px" }}>
          {rootMessages.map((msg, idx) => {
            const replyCount = msg.replyIds?.length || 0;
            const isSelected = selectedId === msg.id;

            return (
              <div key={msg.id} style={{ position: "relative" }}>
                {/* Timeline connector */}
                {idx < rootMessages.length - 1 && (
                  <div
                    style={{
                      position: "absolute",
                      left: "70px",
                      top: "60px",
                      bottom: "-24px",
                      width: "2px",
                      backgroundColor: "#e0e0e0",
                    }}
                  />
                )}

                <div
                  style={{
                    display: "flex",
                    gap: "16px",
                    paddingTop: "24px",
                    cursor: replyCount > 0 ? "pointer" : "default",
                  }}
                  onClick={() => replyCount > 0 && setSelectedId(msg.id)}
                >
                  {/* Timestamp column */}
                  <div
                    style={{
                      width: "70px",
                      flexShrink: 0,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "flex-end",
                      paddingTop: "4px",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "11px",
                        color: "#999",
                        fontFamily: "monospace",
                        fontWeight: 600,
                      }}
                    >
                      {msg.timestamp}
                    </div>
                    {replyCount > 0 && (
                      <div
                        style={{
                          marginTop: "8px",
                          width: "32px",
                          height: "32px",
                          borderRadius: "50%",
                          backgroundColor: isSelected ? "#673ab7" : "#e0e0e0",
                          color: isSelected ? "#fff" : "#666",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: "12px",
                          fontWeight: 600,
                        }}
                      >
                        {replyCount}
                      </div>
                    )}
                  </div>

                  {/* Message content */}
                  <div
                    style={{
                      flex: 1,
                      padding: "14px",
                      backgroundColor: isSelected ? "#f3e5f5" : "#fafafa",
                      border: isSelected ? "2px solid #673ab7" : "2px solid #e0e0e0",
                      borderRadius: "8px",
                      transition: "all 0.2s",
                    }}
                    onMouseEnter={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "#673ab7";
                        e.currentTarget.style.backgroundColor = "#f9f9f9";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!isSelected) {
                        e.currentTarget.style.borderColor = "#e0e0e0";
                        e.currentTarget.style.backgroundColor = "#fafafa";
                      }
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "6px" }}>
                      {msg.author}
                    </div>
                    <div style={{ fontSize: "14px", lineHeight: "1.6", color: "#333" }}>
                      {msg.content}
                    </div>
                    {msg.channels && (
                      <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                        {msg.channels.map((channel) => (
                          <span
                            key={channel}
                            style={{
                              fontSize: "11px",
                              color: "#673ab7",
                              backgroundColor: "#f3e5f5",
                              padding: "3px 8px",
                              borderRadius: "4px",
                              fontWeight: 600,
                            }}
                          >
                            {channel}
                          </span>
                        ))}
                      </div>
                    )}
                    {replyCount > 0 && (
                      <div
                        style={{
                          marginTop: "10px",
                          fontSize: "12px",
                          color: "#673ab7",
                          fontWeight: 600,
                        }}
                      >
                        💬 {replyCount} {replyCount === 1 ? "reply" : "replies"} · Click to view thread
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Context panel */}
      <div
        style={{
          width: "500px",
          backgroundColor: "#fafafa",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {selectedMsg ? (
          <>
            {/* Parent context */}
            {parentChain.length > 0 && (
              <div
                style={{
                  borderBottom: "1px solid #ddd",
                  backgroundColor: "#fff",
                }}
              >
                <div
                  style={{
                    padding: "12px 16px",
                    backgroundColor: "#f5f5f5",
                    borderBottom: "1px solid #ddd",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                  }}
                  onClick={() => setContextCollapsed(!contextCollapsed)}
                >
                  <div
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      color: "#666",
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
                    }}
                  >
                    Thread Context ({parentChain.length} messages)
                  </div>
                  <div style={{ fontSize: "14px", color: "#666" }}>
                    {contextCollapsed ? "▼" : "▲"}
                  </div>
                </div>

                {!contextCollapsed && (
                  <div
                    style={{
                      maxHeight: "200px",
                      overflowY: "auto",
                      padding: "12px",
                    }}
                  >
                    {/* Visual thread line */}
                    <div style={{ position: "relative", paddingLeft: "24px" }}>
                      <div
                        style={{
                          position: "absolute",
                          left: "8px",
                          top: "8px",
                          bottom: "8px",
                          width: "2px",
                          backgroundColor: "#673ab7",
                        }}
                      />

                      {parentChain.map((parent, idx) => (
                        <div
                          key={parent.id}
                          onClick={() => setSelectedId(parent.id)}
                          onMouseEnter={() => setHoveredContextId(parent.id)}
                          onMouseLeave={() => setHoveredContextId(null)}
                          style={{
                            position: "relative",
                            padding: "10px 12px",
                            marginBottom: "8px",
                            backgroundColor:
                              hoveredContextId === parent.id ? "#f3e5f5" : "#fff",
                            border:
                              hoveredContextId === parent.id
                                ? "2px solid #673ab7"
                                : "2px solid #e0e0e0",
                            borderRadius: "6px",
                            cursor: "pointer",
                            transition: "all 0.2s",
                          }}
                        >
                          {/* Thread connector dot */}
                          <div
                            style={{
                              position: "absolute",
                              left: "-20px",
                              top: "18px",
                              width: "8px",
                              height: "8px",
                              borderRadius: "50%",
                              backgroundColor: "#673ab7",
                              border: "2px solid #fff",
                            }}
                          />

                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              marginBottom: "4px",
                            }}
                          >
                            <span
                              style={{
                                fontSize: "10px",
                                color: "#999",
                                fontWeight: 600,
                              }}
                            >
                              {idx + 1}.
                            </span>
                            <span style={{ fontWeight: 600, fontSize: "13px" }}>
                              {parent.author}
                            </span>
                            <span style={{ color: "#999", fontSize: "11px" }}>
                              · {parent.timestamp}
                            </span>
                          </div>
                          <div style={{ fontSize: "12px", color: "#555", lineHeight: "1.4" }}>
                            {parent.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Current message */}
            <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
              <div
                style={{
                  padding: "18px",
                  backgroundColor: "#f3e5f5",
                  borderRadius: "8px",
                  border: "3px solid #673ab7",
                  marginBottom: "16px",
                }}
              >
                <div
                  style={{
                    fontSize: "11px",
                    color: "#673ab7",
                    marginBottom: "8px",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    letterSpacing: "0.5px",
                  }}
                >
                  Current Message
                </div>
                <div style={{ fontSize: "14px", marginBottom: "8px" }}>
                  <span style={{ fontWeight: 600 }}>{selectedMsg.author}</span>
                  <span style={{ color: "#666", marginLeft: "8px" }}>
                    · {selectedMsg.timestamp}
                  </span>
                </div>
                <div style={{ fontSize: "15px", lineHeight: "1.6", color: "#333" }}>
                  {selectedMsg.content}
                </div>
                {selectedMsg.parentId && (
                  <button
                    onClick={() => setSelectedId(selectedMsg.parentId!)}
                    style={{
                      marginTop: "12px",
                      padding: "8px 14px",
                      fontSize: "12px",
                      backgroundColor: "#673ab7",
                      color: "#fff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    ↑ Navigate to parent
                  </button>
                )}
              </div>

              {/* Replies */}
              {replies.length > 0 && (
                <>
                  <h4
                    style={{
                      margin: "0 0 12px 0",
                      fontSize: "12px",
                      color: "#666",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      letterSpacing: "0.5px",
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
                        backgroundColor: "#fff",
                        border: "2px solid #e0e0e0",
                        borderRadius: "6px",
                        cursor:
                          reply.replyIds && reply.replyIds.length > 0 ? "pointer" : "default",
                        transition: "all 0.2s",
                      }}
                      onClick={() =>
                        reply.replyIds && reply.replyIds.length > 0 && setSelectedId(reply.id)
                      }
                      onMouseEnter={(e) => {
                        if (reply.replyIds && reply.replyIds.length > 0) {
                          e.currentTarget.style.borderColor = "#673ab7";
                          e.currentTarget.style.backgroundColor = "#f9f9f9";
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = "#e0e0e0";
                        e.currentTarget.style.backgroundColor = "#fff";
                      }}
                    >
                      <div style={{ fontSize: "13px", marginBottom: "6px" }}>
                        <span style={{ fontWeight: 600 }}>{reply.author}</span>
                        <span style={{ color: "#666", marginLeft: "8px" }}>
                          · {reply.timestamp}
                        </span>
                      </div>
                      <div style={{ fontSize: "14px", lineHeight: "1.5" }}>{reply.content}</div>
                      {reply.replyIds && reply.replyIds.length > 0 && (
                        <div
                          style={{
                            marginTop: "8px",
                            fontSize: "12px",
                            color: "#673ab7",
                            fontWeight: 600,
                          }}
                        >
                          💬 {reply.replyIds.length}
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* Reply input */}
              <input
                type="text"
                placeholder="Write a reply..."
                style={{
                  width: "100%",
                  padding: "12px",
                  border: "2px solid #ddd",
                  borderRadius: "6px",
                  fontSize: "14px",
                  marginTop: "12px",
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
            <div style={{ fontSize: "16px", fontWeight: 600 }}>No thread selected</div>
            <div style={{ fontSize: "13px" }}>Click a message in the timeline to view</div>
          </div>
        )}
      </div>
    </div>
  );
};
