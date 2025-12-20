import { NodeViewContent, NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

const LANGUAGES = [
  { value: "plaintext", label: "Plain text" },
  { value: "javascript", label: "JavaScript" },
  { value: "typescript", label: "TypeScript" },
  { value: "python", label: "Python" },
  { value: "java", label: "Java" },
  { value: "go", label: "Go" },
  { value: "rust", label: "Rust" },
  { value: "c", label: "C" },
  { value: "cpp", label: "C++" },
  { value: "csharp", label: "C#" },
  { value: "ruby", label: "Ruby" },
  { value: "php", label: "PHP" },
  { value: "swift", label: "Swift" },
  { value: "kotlin", label: "Kotlin" },
  { value: "html", label: "HTML" },
  { value: "css", label: "CSS" },
  { value: "scss", label: "SCSS" },
  { value: "json", label: "JSON" },
  { value: "yaml", label: "YAML" },
  { value: "xml", label: "XML" },
  { value: "markdown", label: "Markdown" },
  { value: "sql", label: "SQL" },
  { value: "bash", label: "Bash" },
  { value: "shell", label: "Shell" },
  { value: "dockerfile", label: "Dockerfile" },
  { value: "graphql", label: "GraphQL" },
]

export function CodeBlockComponent({ node, updateAttributes, extension }: NodeViewProps) {
  const language = node.attrs.language || "plaintext"

  return (
    <NodeViewWrapper className="relative my-2">
      <pre className={extension.options.HTMLAttributes?.class}>
        <code>
          <NodeViewContent />
        </code>
      </pre>
      <div className="absolute bottom-2 right-2">
        <Select value={language} onValueChange={(value) => updateAttributes({ language: value })}>
          <SelectTrigger
            className="h-6 w-auto min-w-[100px] gap-1 border-none bg-muted/50 px-2 text-xs text-muted-foreground hover:bg-muted"
            onMouseDown={(e) => e.preventDefault()}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map((lang) => (
              <SelectItem key={lang.value} value={lang.value} className="text-xs">
                {lang.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </NodeViewWrapper>
  )
}
