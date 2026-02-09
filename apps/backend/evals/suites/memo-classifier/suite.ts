/**
 * Memo Classifier Evaluation Suite
 *
 * Tests the MemoClassifier's ability to identify knowledge-worthy messages (gems).
 * Evaluates binary classification (isGem) and knowledge type categorization.
 */

import type { EvalSuite, EvalContext, RunEvaluator, CaseResult } from "../../framework/types"
import { binaryClassificationEvaluator, categoricalEvaluator } from "../../framework/evaluators/classification"
import { MemoClassifier, type MessageClassification } from "../../../src/features/memos"
import { MEMO_MODEL_ID, MEMO_TEMPERATURES } from "../../../src/features/memos"
import { MessageFormatter } from "../../../src/lib/ai/message-formatter"
import { classifierCases, createTestMessage, type ClassifierInput, type ClassifierExpected } from "./cases"
import { messageId } from "../../../src/lib/id"

/**
 * Task function that classifies a message.
 */
async function classifyMessage(input: ClassifierInput, ctx: EvalContext): Promise<MessageClassification> {
  const messageFormatter = new MessageFormatter()
  const classifier = new MemoClassifier(ctx.ai, ctx.configResolver, messageFormatter)

  // Create a test message from the input
  const message = createTestMessage(input, messageId(), ctx.userId)

  // Classify the message
  return classifier.classifyMessage(message, { workspaceId: ctx.workspaceId })
}

/**
 * Accuracy evaluator for run-level metrics.
 * Calculates overall accuracy across all cases.
 */
const accuracyEvaluator: RunEvaluator<MessageClassification, ClassifierExpected> = {
  name: "accuracy",
  evaluate: (results: CaseResult<MessageClassification, ClassifierExpected>[]) => {
    const validResults = results.filter((r) => !r.error)
    if (validResults.length === 0) {
      return { name: "accuracy", score: 0, passed: false, details: "No valid results" }
    }

    const correct = validResults.filter((r) => r.output.isGem === r.expectedOutput.isGem).length
    const accuracy = correct / validResults.length

    return {
      name: "accuracy",
      score: accuracy,
      passed: accuracy >= 0.8,
      details: `${correct}/${validResults.length} correct (${(accuracy * 100).toFixed(1)}%)`,
    }
  },
}

/**
 * Precision evaluator for gems (true positives / predicted positives).
 */
const gemPrecisionEvaluator: RunEvaluator<MessageClassification, ClassifierExpected> = {
  name: "gem-precision",
  evaluate: (results: CaseResult<MessageClassification, ClassifierExpected>[]) => {
    const validResults = results.filter((r) => !r.error)
    const predictedGems = validResults.filter((r) => r.output.isGem)

    if (predictedGems.length === 0) {
      return { name: "gem-precision", score: 1, passed: true, details: "No gems predicted" }
    }

    const truePositives = predictedGems.filter((r) => r.expectedOutput.isGem).length
    const precision = truePositives / predictedGems.length

    return {
      name: "gem-precision",
      score: precision,
      passed: precision >= 0.7,
      details: `${truePositives}/${predictedGems.length} true positives (${(precision * 100).toFixed(1)}% precision)`,
    }
  },
}

/**
 * Recall evaluator for gems (true positives / actual positives).
 */
const gemRecallEvaluator: RunEvaluator<MessageClassification, ClassifierExpected> = {
  name: "gem-recall",
  evaluate: (results: CaseResult<MessageClassification, ClassifierExpected>[]) => {
    const validResults = results.filter((r) => !r.error)
    const actualGems = validResults.filter((r) => r.expectedOutput.isGem)

    if (actualGems.length === 0) {
      return { name: "gem-recall", score: 1, passed: true, details: "No actual gems in dataset" }
    }

    const truePositives = actualGems.filter((r) => r.output.isGem).length
    const recall = truePositives / actualGems.length

    return {
      name: "gem-recall",
      score: recall,
      passed: recall >= 0.7,
      details: `${truePositives}/${actualGems.length} gems detected (${(recall * 100).toFixed(1)}% recall)`,
    }
  },
}

/**
 * Memo Classifier Evaluation Suite
 */
export const memoClassifierSuite: EvalSuite<ClassifierInput, MessageClassification, ClassifierExpected> = {
  name: "memo-classifier",
  description: "Evaluates the MemoClassifier's ability to identify knowledge-worthy messages",

  cases: classifierCases,

  task: classifyMessage,

  evaluators: [
    // Binary classification check (isGem matches expected)
    binaryClassificationEvaluator<MessageClassification, ClassifierExpected, "isGem">("isGem"),

    // Knowledge type check (only evaluated when isGem is true)
    categoricalEvaluator<MessageClassification, ClassifierExpected, "knowledgeType">({
      field: "knowledgeType",
      name: "knowledge-type",
      // Some knowledge types are related and can be interchangeable
      relatedCategories: {
        decision: ["context"], // Decisions often provide context
        context: ["decision", "learning"], // Context can include past decisions or learnings
        learning: ["context"], // Learnings provide context
        procedure: ["reference"], // Procedures can serve as references
        reference: ["procedure"], // References often contain procedures
      },
    }),
  ],

  runEvaluators: [accuracyEvaluator, gemPrecisionEvaluator, gemRecallEvaluator],

  defaultPermutations: [
    {
      model: MEMO_MODEL_ID,
      temperature: MEMO_TEMPERATURES.classification,
    },
  ],
}

export default memoClassifierSuite
