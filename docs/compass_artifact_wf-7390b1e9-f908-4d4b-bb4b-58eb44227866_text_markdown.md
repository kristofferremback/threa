# LLM evaluation for TypeScript projects: the complete 2025 guide

Building reliable AI features requires systematic evaluation—yet the TypeScript ecosystem has been underserved compared to Python. That's changing fast. **Promptfoo, Braintrust, and Langfuse now offer first-class TypeScript support**, making it possible to build production-grade eval pipelines entirely in TypeScript with Bun compatibility. For your stack (Ollama + LangGraph + Claude), the optimal path is starting with Promptfoo for local development and CI, then adding Braintrust or Langfuse as complexity grows.

This guide covers the complete landscape: platform comparison with current pricing, evaluation methodologies for both classification and agentic workflows, prompt management patterns, and a practical roadmap from solo developer to team-scale operations.

## Evaluation platforms with TypeScript support

The eval tooling market has consolidated around several strong options with varying tradeoffs between open-source flexibility and managed convenience.

### Promptfoo: the TypeScript-native starting point

Promptfoo stands out as the **only major eval framework built natively in TypeScript**. With 20k+ GitHub stars and MIT-licensed code, it offers zero-config startup: `npx promptfoo@latest init` gets you running in under five minutes. The framework uses YAML configuration with TypeScript evaluators, supports 50+ providers including native Ollama integration (`ollama:chat:llama3.2`), and includes red-teaming capabilities for 50+ vulnerability types.

Key strengths for your stack: Promptfoo can use local Ollama models as judges for `llm-rubric` assertions, eliminating API costs during development. It supports MCP server testing and multi-step agent evaluation out of the box.

**Pricing**: Community edition is completely free with full features. Enterprise SaaS/on-prem pricing is custom but includes team collaboration, RBAC, and dashboards.

### Braintrust: production-grade with excellent TypeScript DX

Braintrust provides perhaps the best TypeScript developer experience with its `*.eval.ts` file convention and Jest-like declarative API. Their `autoevals` library offers pre-built TypeScript scorers for factuality, hallucination detection, and custom LLM-as-judge patterns. Notion reported a **10x improvement** (3 to 30 issues/day) in their triaging workflow using Braintrust evaluations.

For agentic evaluations, Braintrust offers dedicated scorers: `PlanCoherence`, `ToolAccuracy`, and `FinalAnswerCorrectness`. The platform provides trace-driven evaluation with step-by-step analysis, making it well-suited for LangGraph workflows.

**Pricing**: Free tier available. Usage-based pricing for additional features; enterprise self-hosting option exists but requires contacting sales.

### LangSmith: not LangChain-specific

A common misconception: **LangSmith works with any LLM application without LangChain dependency**. The TypeScript SDK (v0.2+ as of late 2024) includes drop-in OpenAI wrappers via `wrapOpenAI()` and framework-agnostic tracing via `traceable()` decorators. That said, LangSmith does offer native LangGraph integration with specialized multi-step workflow visualization.

| Plan | Monthly Cost | Free Traces | Retention |
|------|-------------|-------------|-----------|
| Developer | Free | 5,000 | 14 days |
| Plus | $39/seat | 10,000 | 14 days |
| Enterprise | Custom | Custom | 400 days |

Additional traces cost $0.50 per 1,000 (base) or $5.00 per 1,000 (extended retention).

### Open-source alternatives: Langfuse and Arize Phoenix

**Langfuse** (MIT license, 18k+ GitHub stars) offers full self-hosting via Docker with no feature gates—the only major platform where self-hosted matches cloud capabilities. The TypeScript SDK v4 includes OpenTelemetry-native integration and `@observe()` decorators. Pricing: Hobby tier free (50k observations/month), Pro ~$59/month, self-hosted unlimited.

**Arize Phoenix** (open-source) provides the `@arizeai/phoenix-client` TypeScript package with OpenTelemetry-based tracing. It's particularly strong for RAG evaluations with pre-tested templates. Free self-hosted; free cloud tier available.

### Platform capability matrix

| Platform | TypeScript SDK | Classification | Agentic/Multi-step | Self-hosted | Starting Price |
|----------|---------------|----------------|-------------------|-------------|----------------|
| Promptfoo | Native (best) | ✅ Full | ✅ Full | Free (full features) | $0 |
| Braintrust | Excellent | ✅ Full | ✅ Full (trace-driven) | Enterprise only | Free tier |
| LangSmith | Good (v0.2+) | ✅ Full | ✅ Full (LangGraph native) | Enterprise only | Free tier |
| Langfuse | Native | ✅ Full | ✅ Good | Free (MIT) | $0 |
| W&B Weave | Good | ✅ Full | ✅ Full | Enterprise only | Free tier |
| Arize Phoenix | Available | ✅ Full | ✅ Good | Free (open-source) | $0 |

**Notable sunset**: Humanloop announced acquisition by Anthropic and will sunset September 8, 2025. Migrate to alternatives if currently using it.

## Classification evaluation best practices

For your Ollama-based classification tasks, systematic evaluation requires precision/recall measurement, threshold tuning, and robust test dataset management.

### Metrics and measurement

Choose metrics based on error costs: **precision** minimizes false positives (important when false classifications have high downstream cost), while **recall** minimizes false negatives (important when missing a classification is costly). F1 score provides balanced assessment. For multi-class classification, track confusion matrices to identify systematic misclassification patterns.

Implementation with Braintrust TypeScript:
```typescript
import { Eval } from "braintrust";

Eval("ClassificationTest", {
  data: () => testCases,
  task: async (input) => await classifier.predict(input),
  scores: [
    (output, expected) => ({
      name: "precision",
      score: calculatePrecision(output, expected)
    })
  ]
});
```

### Threshold tuning and calibration

Classification thresholds directly trade precision against recall. Use ROC curves to find optimal thresholds for your specific use case. Monitor confidence distributions over time—model calibration can drift with changing input distributions. For production systems, consider cost-sensitive thresholds where business impact differs across error types.

### Test dataset management

Start with **50-100 examples** covering common cases, edge cases, and known failure modes. Every production failure should become a new test case. Version control datasets alongside code using Git-compatible formats (JSON, CSV). Maintain separate datasets for development iteration, regression testing, and adversarial evaluation.

For ground truth labeling, **bootstrap with LLMs**: use GPT-4 to generate initial "silver" labels, then refine critical samples with human review. This approach reduces labeling cost while maintaining quality on high-stakes examples.

## Agentic and multi-step evaluation strategies

Evaluating LangGraph-style agents requires fundamentally different approaches than classification. The key distinction: **trajectory evaluation** examines the entire execution path, not just final outputs.

### Two evaluation paradigms

**Black-box (final response)**: Evaluate only input→output mapping. Simple and flexible but doesn't explain failures or catch inefficient paths.

**Glass-box (trajectory)**: Evaluate tool calls, reasoning steps, and state transitions throughout execution. Catches wrong tool order, unnecessary steps, and reasoning errors. More complex to implement but provides actionable debugging information.

For LangGraph agents, glass-box evaluation is essential. LangSmith offers native integration:
```typescript
import { aevaluate } from "langsmith";

const rightTool = (outputs) => {
  const toolCalls = outputs["messages"][1].tool_calls;
  return toolCalls && toolCalls[0]["name"] === "search";
};

await aevaluate(target, {
  data: "weather agent",
  evaluators: [correctAnswer, rightTool],
  experimentPrefix: "claude-3.5-baseline"
});
```

### Tool selection accuracy

Evaluate three dimensions: **correct tool selection** (did the agent choose the right tool?), **parameter accuracy** (were correct arguments passed?), and **timing** (was the tool called at the appropriate step?). The Berkeley Function-Calling Leaderboard (BFCL) provides standardized benchmarks for tool use capability.

### Hallucination detection in agent outputs

Agent hallucinations typically occur when models fabricate tool outputs or misrepresent retrieved information. Detection approaches include:

- **Faithfulness scoring**: Compare outputs against source documents using NLI models
- **Self-consistency checks**: Generate multiple outputs at low temperature and detect contradictions  
- **Fact verification**: Cross-reference claims against retrieval context
- **LLM-as-judge**: Use evaluator model to identify unsupported claims

## LLM-as-judge implementation patterns

Using one LLM to evaluate another has become the dominant approach for scalable quality assessment. However, implementation details significantly impact reliability.

### Judge model selection

**Tier 1 (most reliable)**: GPT-4/GPT-4o offers best generalization and robustness to prompt variations. Claude 3.5 Sonnet provides strong nuanced reasoning.

**Tier 2**: Llama-3 70B achieves ~0.88 agreement with human judgments (Scott's Pi metric). DeepSeek-V2.5 offers strong performance at lower cost.

**Critical insight**: Use a different model family for judging than for generation. Research shows "LLM Evaluators Recognize and Favor Their Own Generations"—using Claude to judge GPT outputs (or vice versa) reduces bias.

### Scoring approach matters significantly

**Use categorical scales, not continuous**. LLMs struggle with 0-100 ranges, producing inconsistent scores. Binary (pass/fail) or 1-5 scales dramatically improve reliability. Arize research confirms: "We recommend using categorical evaluations in production."

**Additive rubrics outperform holistic scoring**:
```
Award 1 point if the answer addresses the question
Add 1 point if factually accurate  
Add 1 point if well-structured
Add 1 point if includes supporting evidence
```

### Mitigating judge bias

Position bias (order affects judgment), verbosity bias (longer = higher scores), and self-preference are well-documented issues. Countermeasures:

- Randomize option order for pairwise comparisons
- Use ensemble of multiple judge models with voting
- Calibrate against ~30 human-labeled examples
- Request reasoning before score (improves consistency from 65% to 77.5%)

## Prompt management and version control

Treating prompts as code requires dedicated tooling beyond traditional version control.

### Git-based vs dedicated registries

**Git-based approach**: Store prompts in `/prompts` directory as `.txt` or TypeScript files. Full control, free, integrates with existing code review. Downside: manual versioning, no UI for non-technical collaborators.

**Prompt registries** (Braintrust, Langfuse): Automatic versioning, hot-reload without deployment, collaboration UI. Tradeoff: additional dependency, potential vendor lock-in.

**Recommended hybrid**: Use Git as source of truth, sync to a registry for runtime serving and non-technical collaboration.

### Environment-specific configuration

```typescript
const PROMPT_VERSIONS = {
  development: undefined,      // Always latest
  staging: "latest",           // Latest but tracked  
  production: "v2.1.0",        // Pinned version
};

export const getPrompt = async (slug: string) => {
  return loadPrompt({
    slug,
    version: PROMPT_VERSIONS[process.env.NODE_ENV],
  });
};
```

### Hot-reloading without redeployment

Both Braintrust and Langfuse support runtime prompt loading with caching. This enables prompt iteration without code deployment—particularly valuable for non-technical stakeholders who need to tune prompts:

```typescript
// Braintrust pattern
const prompt = await loadPrompt({
  projectName: "your-project",
  slug: "summarizer",
  version: process.env.NODE_ENV === "production" 
    ? "5878bd218351fb8e"  // Pinned hash
    : undefined,          // Latest in dev
});
```

## A/B testing prompts effectively

Systematic prompt comparison requires proper experimental design, not just running both versions.

### Implementation with Langfuse

```typescript
const promptA = await langfuse.prompt.get("my-prompt", { label: "prod-a" });
const promptB = await langfuse.prompt.get("my-prompt", { label: "prod-b" });

// Random selection with analytics linking
const selectedPrompt = Math.random() < 0.5 ? promptA : promptB;
const completion = await openai.chat.completions.create({
  messages: [{ role: "user", content: selectedPrompt.compile({ variable: "value" }) }],
  langfusePrompt: selectedPrompt, // Links for tracking
});
```

### Statistical rigor

**Isolate single variables**: Change only one element per experiment. **Randomize users, not requests**: Each user should experience only one variant to avoid confusion effects. **Gradual rollout**: Start at 5-10%, ramp to 25%, 50%, then 100% only after confirming metrics.

For significance testing, use paired t-tests for continuous scores or McNemar's test for binary outcomes. A **5%+ improvement** is a strong signal; improvements under 2% may be noise requiring larger samples.

## Model comparison workflows

Comparing local Ollama models against Claude/GPT requires standardizing evaluation across different model types.

### Cost versus quality tradeoffs

API model costs scale linearly: Claude Sonnet at 10,000 daily users with 5 exchanges costs roughly **$2,250/day**. Gemini Flash drops to ~$22/day for equivalent volume. Local deployment via Ollama requires $4,000-8,000 upfront hardware plus $150-200/month electricity—break-even typically at 2-3 months of high-volume usage.

**Critical insight**: Benchmark scores don't predict application performance. GPT-4.1 scores higher than Claude on knowledge benchmarks, but Claude outperforms on software engineering tasks. Build custom evals from your actual production data.

### Promptfoo multi-model comparison

```yaml
providers:
  - ollama:chat:llama3.2
  - openai:gpt-4.1-mini  
  - anthropic:messages:claude-sonnet-4-20250514
tests:
  - vars:
      question: "Classify this support ticket..."
    assert:
      - type: llm-rubric
        value: "Classification should match expected category"
```

### Ollama-specific considerations

Promptfoo's Ollama integration supports using local models as evaluation judges, eliminating API costs during development. Use serial evaluation mode (`-j 1`) to conserve memory when running against local models. For latency benchmarking, tools like `ollama-benchmark` measure tokens/second with automatic model selection based on available RAM.

## CI/CD integration patterns

Automated evaluation in CI pipelines catches regressions before deployment but requires careful cost management.

### GitHub Actions with Promptfoo

```yaml
name: LLM Eval
on:
  pull_request:
    paths: ['prompts/**', 'promptfooconfig.yaml']

jobs:
  evaluate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22' }
      
      - name: Cache promptfoo
        uses: actions/cache@v4
        with:
          path: ~/.cache/promptfoo
          key: ${{ runner.os }}-promptfoo-${{ hashFiles('prompts/**') }}
      
      - name: Run eval
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
          PROMPTFOO_CACHE_PATH: ~/.cache/promptfoo
        run: npx promptfoo@latest eval -c promptfooconfig.yaml -o results.json
      
      - name: Quality Gate
        run: |
          PASS_RATE=$(jq '.results.stats.successes / (.results.stats.successes + .results.stats.failures) * 100' results.json)
          if (( $(echo "$PASS_RATE < 95" | bc -l) )); then
            echo "❌ Quality gate failed: ${PASS_RATE}% < 95%"
            exit 1
          fi
```

### Eval timing and cost management

| Eval Type | When to Run | Budget |
|-----------|-------------|--------|
| Smoke tests (5-10 cases) | Every PR | ~$0.10-0.50 |
| Full regression (50-100 cases) | Pre-merge, nightly | ~$1-5 |
| Red team/security | Weekly | ~$5-20 |

**Cache aggressively**: Cache LLM responses to avoid repeat API calls across runs. Promptfoo supports `PROMPTFOO_CACHE_PATH` with configurable TTL. **Tier your strategy**: Quick tests on PR, comprehensive tests nightly, security scans weekly.

## Getting started: zero to one

For a solo developer, start simple and add complexity only when specific failure modes demand it.

### Week one checklist

1. **Install Promptfoo**: `npx promptfoo@latest init`
2. **Create 5-10 test cases** from real user queries or expected inputs
3. **Add basic assertions**: `contains`, `contains-json`, `llm-rubric`
4. **Run first eval**: `npx promptfoo eval && npx promptfoo view`
5. **Set up Ollama for grading**: Use local models as judges to eliminate API costs
6. **Add to CI**: Fail builds when pass rate drops below threshold

### Minimum viable eval

Start with three evaluation types:
- **Correctness**: Does output contain expected facts?
- **Format compliance**: Does output match required structure?
- **Safety**: Does output avoid harmful content?

This covers most immediate needs without over-engineering.

### Scaling progression

**Stage 1 (solo, <1k evals/month)**: Promptfoo + Ollama for local grading. Cost: ~$0-10/month.

**Stage 2 (small team, 1k-50k evals/month)**: Add Braintrust or Langfuse for experiment tracking. Integrate into CI/CD. Cost: $50-500/month.

**Stage 3 (production scale, 50k+ evals/month)**: Full platform solution with real-time monitoring, human-in-the-loop annotation queues, comprehensive regression detection. Cost: $500-5000/month.

## Common pitfalls to avoid

**Trusting benchmarks over application-specific evals**: High scores on MMLU or HumanEval don't guarantee your specific use case performs well. Build custom evals from production data.

**Over-engineering early**: 85% of GenAI projects fail due to insufficient testing, but elaborate infrastructure before validating the core use case wastes resources. Start with 5-10 hand-written test cases.

**Under-engineering at scale**: Teams of 7+ engineers manually reviewing outputs in spreadsheets waste significant engineering time. Automate with LLM-as-judge once patterns are understood.

**Wrong scoring scales**: Continuous 0-100 scoring produces inconsistent results. Use categorical (pass/fail, 1-5) scales.

**Same-family judging**: Using GPT-4 to judge GPT-4 outputs introduces self-preference bias. Cross-evaluate with different model families.

**Following model hype without testing**: New model releases don't automatically improve your application. A/B test with real traffic for at least one week before switching.

## Recommended stack for your setup

Given your Ollama + LangGraph + Claude + Bun stack:

**Development phase**: Promptfoo for eval framework (TypeScript-native, Ollama integration, free). Use Ollama models as local judges during iteration.

**Production monitoring**: Add Langfuse (self-hostable, MIT license) or Braintrust (better TypeScript DX) for experiment tracking and production tracing.

**Agentic evaluation**: Use LangSmith's trajectory evaluation for LangGraph agents, or Braintrust's `ToolAccuracy` and `PlanCoherence` scorers.

**CI/CD**: Promptfoo GitHub Actions with quality gates at 95%+ pass rate. Cache aggressively to control costs.

All recommended tools are Bun-compatible and work well with TypeScript throughout.