// Graph-based message structure - messages are nodes with parent references

export interface GraphMessage {
  id: string;
  author: string;
  timestamp: string;
  content: string;
  channels?: string[];
  parentId?: string; // Reference to parent node
  replyIds?: string[]; // References to child nodes
}

// Flat message store - all messages at the same level
export const messageGraph: Record<string, GraphMessage> = {
  "msg-1": {
    id: "msg-1",
    author: "Alice",
    timestamp: "2:30 PM",
    content: "We need to fix the API issue",
    channels: ["#engineering", "#api", "#security"],
    replyIds: ["msg-2", "msg-5"],
  },
  "msg-2": {
    id: "msg-2",
    author: "Bob",
    timestamp: "2:31 PM",
    content: "What's the error message?",
    parentId: "msg-1",
    replyIds: ["msg-3", "msg-4"],
  },
  "msg-3": {
    id: "msg-3",
    author: "Alice",
    timestamp: "2:32 PM",
    content: "Connection timeout after 30s",
    parentId: "msg-2",
    replyIds: ["msg-9"],
  },
  "msg-4": {
    id: "msg-4",
    author: "Bob",
    timestamp: "2:33 PM",
    content: "That's the database pool",
    parentId: "msg-2",
    replyIds: ["msg-10"],
  },
  "msg-5": {
    id: "msg-5",
    author: "Charlie",
    timestamp: "2:35 PM",
    content: "I can look at connection pooling",
    parentId: "msg-1",
    replyIds: ["msg-6"],
  },
  "msg-6": {
    id: "msg-6",
    author: "Alice",
    timestamp: "2:36 PM",
    content: "Thanks, here's the logs",
    parentId: "msg-5",
    replyIds: ["msg-11"],
  },
  "msg-7": {
    id: "msg-7",
    author: "Bob",
    timestamp: "2:45 PM",
    content: "Great deploy today",
  },
  "msg-8": {
    id: "msg-8",
    author: "Charlie",
    timestamp: "3:00 PM",
    content: "Anyone free for lunch? 🍕",
    replyIds: ["msg-12"],
  },
  "msg-9": {
    id: "msg-9",
    author: "Dave",
    timestamp: "2:37 PM",
    content: "I've seen this before, check the connection string",
    parentId: "msg-3",
  },
  "msg-10": {
    id: "msg-10",
    author: "Charlie",
    timestamp: "2:38 PM",
    content: "Yeah, we might need to increase the pool size",
    parentId: "msg-4",
  },
  "msg-11": {
    id: "msg-11",
    author: "Dave",
    timestamp: "2:40 PM",
    content: "I'll review the logs and get back to you",
    parentId: "msg-6",
  },
  "msg-12": {
    id: "msg-12",
    author: "Alice",
    timestamp: "3:02 PM",
    content: "I'm in! Where are we going?",
    parentId: "msg-8",
  },
};

// Helper to get root messages (no parent)
export const getRootMessages = (): GraphMessage[] => {
  return Object.values(messageGraph).filter((msg) => !msg.parentId);
};

// Helper to get message by ID
export const getMessage = (id: string): GraphMessage | undefined => {
  return messageGraph[id];
};

// Helper to get all replies to a message
export const getReplies = (id: string): GraphMessage[] => {
  const msg = messageGraph[id];
  if (!msg || !msg.replyIds) return [];
  return msg.replyIds.map((replyId) => messageGraph[replyId]).filter(Boolean);
};

// Helper to get parent chain (for breadcrumbs)
export const getParentChain = (id: string): GraphMessage[] => {
  const chain: GraphMessage[] = [];
  let current = messageGraph[id];

  while (current?.parentId) {
    current = messageGraph[current.parentId];
    if (current) {
      chain.unshift(current);
    }
  }

  return chain;
};

// Helper to count all descendants
export const countDescendants = (id: string): number => {
  const msg = messageGraph[id];
  if (!msg || !msg.replyIds) return 0;

  let count = msg.replyIds.length;
  msg.replyIds.forEach((replyId) => {
    count += countDescendants(replyId);
  });

  return count;
};
