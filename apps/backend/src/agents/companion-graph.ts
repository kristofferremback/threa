import { Annotation, MessagesAnnotation, StateGraph, END } from "@langchain/langgraph"
import { AIMessage, HumanMessage, SystemMessage } from "@langchain/core/messages"
import type { ChatOpenAI } from "@langchain/openai"
import type { BaseMessage } from "@langchain/core/messages"

/**
 * State annotation for the companion agent graph.
 *
 * Extends MessagesAnnotation to get message history handling,
 * and adds custom fields for our companion context.
 */
export const CompanionState = Annotation.Root({
  // Inherit message handling from MessagesAnnotation
  ...MessagesAnnotation.spec,

  // System prompt (set once at graph invocation, doesn't change)
  systemPrompt: Annotation<string>(),

  // Final response text for easy extraction after graph completes
  finalResponse: Annotation<string | null>({
    default: () => null,
    reducer: (_, next) => next,
  }),
})

export type CompanionStateType = typeof CompanionState.State

/**
 * Create the agent node function.
 *
 * This node invokes the LLM with the system prompt and conversation history.
 * Returns the assistant's response which gets appended to messages.
 */
function createAgentNode(model: ChatOpenAI) {
  return async (state: CompanionStateType): Promise<Partial<CompanionStateType>> => {
    const systemMessage = new SystemMessage(state.systemPrompt)

    const response = await model.invoke([systemMessage, ...state.messages])

    // Extract text content from response
    let responseText: string
    switch (true) {
      case typeof response.content === "string":
        responseText = response.content
        break

      case Array.isArray(response.content):
        responseText = response.content
          .filter((c): c is { type: "text"; text: string } => c.type === "text")
          .map((c) => c.text)
          .join("")
        break

      default:
        responseText = ""
    }

    return {
      messages: [response],
      finalResponse: responseText,
    }
  }
}

/**
 * Placeholder tools node for future GAM capabilities.
 *
 * When tools are added (search_memos, search_messages, etc.),
 * this node will execute them and return results.
 */
function createToolsNode() {
  return async (state: CompanionStateType): Promise<Partial<CompanionStateType>> => {
    // Placeholder - will be implemented when adding GAM tools
    // For now, just pass through (tools node won't be reached without tool_calls)
    return {}
  }
}

/**
 * Determine whether to continue to tools or end.
 *
 * Checks if the last message has tool_calls. If so, route to tools node.
 * Otherwise, end the graph.
 */
function shouldContinue(state: CompanionStateType): "tools" | typeof END {
  const lastMessage = state.messages[state.messages.length - 1]

  // Check if the AI wants to use tools
  if (lastMessage instanceof AIMessage && lastMessage.tool_calls?.length) {
    return "tools"
  }

  return END
}

/**
 * Create the companion agent graph.
 *
 * Graph structure:
 *   START → agent ─┬─ (tool_calls?) → tools → agent
 *                  └─ (no tools)   → END
 *
 * @param model The ChatOpenAI model instance configured for OpenRouter
 * @returns A StateGraph that can be compiled with a checkpointer
 */
export function createCompanionGraph(model: ChatOpenAI) {
  const graph = new StateGraph(CompanionState)
    .addNode("agent", createAgentNode(model))
    .addNode("tools", createToolsNode())
    .addEdge("__start__", "agent")
    .addConditionalEdges("agent", shouldContinue)
    .addEdge("tools", "agent")

  return graph
}

/**
 * Convert our message format to LangChain messages.
 */
export function toLangChainMessages(messages: Array<{ role: "user" | "assistant"; content: string }>): BaseMessage[] {
  return messages.map((m) => (m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)))
}
