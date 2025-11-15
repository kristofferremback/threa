// Sample conversation data for wireframe prototypes

export interface Message {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  replies?: Message[];
  channels?: string[];
}

export const sampleMessages: Message[] = [
  {
    id: "msg-1",
    author: "Alice",
    timestamp: "2:30 PM",
    content: "We need to fix the API issue",
    channels: ["#engineering", "#api", "#security"],
    replies: [
      {
        id: "msg-2",
        author: "Bob",
        timestamp: "2:31 PM",
        content: "What's the error message?",
        replies: [
          {
            id: "msg-3",
            author: "Alice",
            timestamp: "2:32 PM",
            content: "Connection timeout after 30s",
          },
          {
            id: "msg-4",
            author: "Bob",
            timestamp: "2:33 PM",
            content: "That's the database pool",
          },
        ],
      },
      {
        id: "msg-5",
        author: "Charlie",
        timestamp: "2:35 PM",
        content: "I can look at connection pooling",
        replies: [
          {
            id: "msg-6",
            author: "Alice",
            timestamp: "2:36 PM",
            content: "Thanks, here's the logs",
          },
        ],
      },
    ],
  },
  {
    id: "msg-7",
    author: "Bob",
    timestamp: "2:45 PM",
    content: "Great deploy today",
  },
  {
    id: "msg-8",
    author: "Charlie",
    timestamp: "3:00 PM",
    content: "Anyone free for lunch? 🍕",
  },
];
