import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

interface MessageItemProps {
  message: Message;
  depth?: number;
}

const MessageItem: React.FC<MessageItemProps> = ({ message, depth = 0 }) => {
  const [expanded, setExpanded] = useState(depth < 2);

  const depthMarkers = ["•", "◦", "▪", "▫", "▸"];
  const marker = depth > 0 ? depthMarkers[Math.min(depth - 1, depthMarkers.length - 1)] : "";

  const hasReplies = message.replies && message.replies.length > 0;
  const replyCount = message.replies?.length || 0;

  return (
    <div style={{ marginBottom: "8px" }}>
      <div
        style={{
          border: "1px solid #ddd",
          borderRadius: "4px",
          padding: "12px",
          marginLeft: `${depth * 24}px`,
          backgroundColor: depth === 0 ? "#fff" : depth === 1 ? "#f9f9f9" : "#f5f5f5",
          cursor: hasReplies ? "pointer" : "default",
        }}
        onClick={() => hasReplies && setExpanded(!expanded)}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {marker && <span style={{ color: "#666", fontSize: "14px" }}>{marker}</span>}
            <span style={{ fontWeight: 600, fontSize: "14px" }}>{message.author}</span>
            <span style={{ color: "#666", fontSize: "12px" }}>· {message.timestamp}</span>
            {message.channels && (
              <div style={{ display: "flex", gap: "4px", marginLeft: "8px" }}>
                {message.channels.map((channel) => (
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
          {hasReplies && (
            <span style={{ fontSize: "12px", color: "#666" }}>
              {expanded ? "−" : "+"}
            </span>
          )}
        </div>
        <div style={{ marginTop: "6px", fontSize: "14px", lineHeight: "1.4" }}>
          {message.content}
        </div>
        {hasReplies && !expanded && (
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
            💬 {replyCount} {replyCount === 1 ? "reply" : "replies"}
          </div>
        )}
      </div>

      {expanded && hasReplies && (
        <div>
          {message.replies!.map((reply) => (
            <MessageItem key={reply.id} message={reply} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
};

export const Option1InlineCollapse: React.FC<{ messages: Message[] }> = ({ messages }) => {
  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
        <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
      </div>
      {messages.map((message) => (
        <MessageItem key={message.id} message={message} />
      ))}
    </div>
  );
};
