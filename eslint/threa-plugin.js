function isIdentifierNamed(node, name) {
  return node?.type === "Identifier" && node.name === name
}

function isMemberPropertyNamed(node, name) {
  return !node?.computed && isIdentifierNamed(node?.property, name)
}

function isPascalCaseName(name) {
  return typeof name === "string" && /^[A-Z][A-Za-z0-9]*$/.test(name)
}

function getFunctionName(node) {
  if (!node) return null

  if (node.type === "FunctionDeclaration" && node.id) {
    return node.id.name
  }

  if (
    (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
    node.parent?.type === "VariableDeclarator" &&
    node.parent.id.type === "Identifier"
  ) {
    return node.parent.id.name
  }

  if (
    (node.type === "ArrowFunctionExpression" || node.type === "FunctionExpression") &&
    node.parent?.type === "Property" &&
    node.parent.key.type === "Identifier"
  ) {
    return node.parent.key.name
  }

  return null
}

function functionReturnsJsx(node) {
  if (!node) return false

  if (node.type === "ArrowFunctionExpression" && node.body) {
    if (node.body.type === "JSXElement" || node.body.type === "JSXFragment") {
      return true
    }
  }

  if (!node.body || node.body.type !== "BlockStatement") {
    return false
  }

  const queue = [...node.body.body]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current) continue

    if (
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "ArrowFunctionExpression"
    ) {
      continue
    }

    if (current.type === "ReturnStatement") {
      const argument = current.argument
      if (argument?.type === "JSXElement" || argument?.type === "JSXFragment") {
        return true
      }
      continue
    }

    if (current.type === "BlockStatement") {
      queue.push(...current.body)
      continue
    }

    for (const [key, value] of Object.entries(current)) {
      if (key === "parent") {
        continue
      }

      if (!value) continue
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item?.type) queue.push(item)
        }
      } else if (value.type) {
        queue.push(value)
      }
    }
  }

  return false
}

function isComponentFunction(node) {
  const name = getFunctionName(node)
  return isPascalCaseName(name) && functionReturnsJsx(node)
}

function isAllowedGetQueryDataUsage(node) {
  const parent = node.parent

  if (parent?.type !== "CallExpression") {
    return false
  }

  if (parent.callee !== node) {
    return false
  }

  let current = parent
  while (current.parent) {
    current = current.parent

    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionExpression" ||
      current.type === "FunctionDeclaration"
    ) {
      const enclosingName = getFunctionName(current)
      return enclosingName ? !isPascalCaseName(enclosingName) : true
    }
  }

  return false
}

function getNearestFunction(ancestors) {
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const ancestor = ancestors[index]
    if (
      ancestor.type === "FunctionDeclaration" ||
      ancestor.type === "FunctionExpression" ||
      ancestor.type === "ArrowFunctionExpression"
    ) {
      return ancestor
    }
  }

  return null
}

const noNestedComponentDefinitionsRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow React component definitions inside other components",
    },
    schema: [],
    messages: {
      nested: "Do not define components inside other components (INV-18). Move this component to module scope.",
    },
  },
  create(context) {
    function check(node) {
      if (!isComponentFunction(node)) {
        return
      }

      const ancestors = context.sourceCode.getAncestors(node)
      const parentFunction = getNearestFunction(ancestors)

      if (parentFunction && isComponentFunction(parentFunction)) {
        context.report({ node, messageId: "nested" })
      }
    }

    return {
      FunctionDeclaration: check,
      FunctionExpression: check,
      ArrowFunctionExpression: check,
    }
  },
}

const noQueryClientGetQueryDataInRenderRule = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow queryClient.getQueryData reads directly during component render",
    },
    schema: [],
    messages: {
      renderRead:
        "Do not call queryClient.getQueryData() directly in render for reactive reads. Use a cache-only useQuery observer instead.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        if (!isMemberPropertyNamed(node.callee, "getQueryData")) {
          return
        }

        if (isAllowedGetQueryDataUsage(node.callee)) {
          return
        }

        const ancestors = context.sourceCode.getAncestors(node)
        const nearestFunction = getNearestFunction(ancestors)

        if (nearestFunction && isComponentFunction(nearestFunction)) {
          context.report({ node, messageId: "renderRead" })
        }
      },
    }
  },
}

const threaPlugin = {
  rules: {
    "no-nested-component-definitions": noNestedComponentDefinitionsRule,
    "no-queryclient-getquerydata-in-render": noQueryClientGetQueryDataInRenderRule,
  },
}

export default threaPlugin
