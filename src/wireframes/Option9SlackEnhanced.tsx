import React, { useState } from "react";
import { Message } from "../data/sampleMessages";

export const Option9SlackEnhanced: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const [selectedThread, setSelectedThread] = useState<Message | null>(null);

  const countReplies = (msg: Message): number => {
    if (!msg.replies) return 0;
    return msg.replies.length + msg.replies.reduce((acc, r) => acc + countReplies(r), 0);
  };

  const getLastReplyTime = (msg: Message): string => {
    let lastTime = msg.timestamp;
    const findLast = (m: Message) => {
      if (m.replies && m.replies.length > 0) {
        m.replies.forEach((r) => {
          lastTime = r.timestamp;
          findLast(r);
        });
      }
    };
    findLast(msg);
    return lastTime;
  };

  const renderThreadPanel = (msg: Message) => {
    const renderThreadTree = (m: Message, depth = 0): JSX.Element => (
      <div key={m.id} style={{ marginBottom: "12px" }}>
        <div
          style={{
            padding: "10px",
            backgroundColor: depth === 0 ? "#f0f7ff" : "#fff",
            borderRadius: "4px",
            border: depth === 0 ? "2px solid #0066cc" : "1px solid #eee",
          }}
        >
          <div style={{ fontSize: "13px" }}>
            <span style={{ fontWeight: 600 }}>{m.author}</span>
            <span style={{ color: "#666", marginLeft: "8px" }}>· {m.timestamp}</span>
          </div>
          <div style={{ fontSize: "14px", marginTop: "4px", lineHeight: "1.4" }}>
            {m.content}
          </div>
          {m.replies && m.replies.length > 0 && (
            <div style={{ marginTop: "8px", fontSize: "12px", color: "#666" }}>
              {m.replies.map((r) => (
                <div key={r.id} style={{ marginLeft: "8px" }}>
                  └ {r.author}
                </div>
              ))}
            </div>
          )}
        </div>
        {m.replies && m.replies.map((reply) => (
          <div key={reply.id} style={{ marginLeft: "20px", marginTop: "8px" }}>
            {renderThreadTree(reply, depth + 1)}
          </div>
        ))}
      </div>
    );

    return (
      <div style={{ padding: "16px", height: "100%", overflowY: "auto", backgroundColor: "#fafafa" }}>
        <div style={{ marginBottom: "16px", paddingBottom: "12px", borderBottom: "1px solid #ddd" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>💬 Thread</h3>
          <div style={{ fontSize: "13px", color: "#666", marginTop: "4px" }}>
            {msg.content.slice(0, 50)}...
          </div>
          {msg.channels && (
            <div style={{ display: "flex", gap: "4px", marginTop: "8px" }}>
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
        <div style={{ marginBottom: "16px", fontSize: "13px", color: "#666" }}>
          {countReplies(msg)} replies
        </div>
        {renderThreadTree(msg)}
        <div style={{ marginTop: "16px", paddingTop: "12px", borderTop: "1px solid #ddd" }}>
          <input
            type="text"
            placeholder="Reply..."
            style={{
              width: "100%",
              padding: "8px",
              border: "1px solid #ddd",
              borderRadius: "4px",
              fontSize: "14px",
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", height: "600px", maxWidth: "1200px", margin: "0 auto", border: "1px solid #ddd" }}>
      <div style={{ flex: 1, borderRight: "1px solid #ddd", overflowY: "auto", padding: "16px" }}>
        <div style={{ marginBottom: "16px", padding: "12px", backgroundColor: "#f5f5f5", borderRadius: "4px" }}>
          <h3 style={{ margin: 0, fontSize: "16px" }}>#engineering</h3>
        </div>

        {messages.map((message) => {
          const replyCount = countReplies(message);
          const lastReply = replyCount > 0 ? getLastReplyTime(message) : null;

          return (
            <div
              key={message.id}
              style={{
                padding: "12px",
                marginBottom: "8px",
                borderRadius: "4px",
                cursor: replyCount > 0 ? "pointer" : "default",
                backgroundColor: selectedThread?.id === message.id ? "#f0f7ff" : "#fff",
                border: selectedThread?.id === message.id ? "2px solid #0066cc" : "1px solid #eee",
              }}
              onClick={() => replyCount > 0 && setSelectedThread(message)}
            >
              <div style={{ fontSize: "13px", marginBottom: "4px" }}>
                <span style={{ fontWeight: 600 }}>{message.author}</span>
                <span style={{ color: "#666", marginLeft: "8px" }}>· {message.timestamp}</span>
              </div>
              <div style={{ fontSize: "14px", lineHeight: "1.4" }}>{message.content}</div>
              {replyCount > 0 && (
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#0066cc" }}>
                  💬 {replyCount} {replyCount === 1 ? "reply" : "replies"} · Last: {lastReply} [→]
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ width: "400px" }}>
        {selectedThread ? (
          renderThreadPanel(selectedThread)
        ) : (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100%",
              color: "#999",
              backgroundColor: "#fafafa",
            }}
          >
            Select a thread to view
          </div>
        )}
      </div>
    </div>
  );
};
