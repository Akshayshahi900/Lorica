import type { CodeGraph, GraphNode, RelationshipType } from "@lorica/types";
import path from "path";
import Parser from "tree-sitter";

export type ParsedFile = {
  relativePath: string;
  tree: Parser.Tree;
};

type ImportBinding = {
  targetFileId: string;
  symbolName?: string;
};

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];

function addRelationship(
  graph: CodeGraph,
  seen: Set<string>,
  from: string,
  type: RelationshipType,
  to: string,
): void {
  if (from === to) return;
  const key = `${from}\u0000${type}\u0000${to}`;
  if (seen.has(key)) return;
  seen.add(key);
  graph.relationships.push({ from, type, to });
}

function isWithin(node: Parser.SyntaxNode, ancestorType: string): boolean {
  for (
    let current: Parser.SyntaxNode | null = node.parent;
    current;
    current = current.parent
  ) {
    if (current.type === ancestorType) return true;
  }
  return false;
}

function sourceForNode(
  nodes: GraphNode[],
  filePath: string,
  node: Parser.SyntaxNode,
  allowedTypes: GraphNode["type"][],
): string | undefined {
  const line = node.startPosition.row + 1;
  const column = node.startPosition.column;
  const candidates = nodes.filter(
    (candidate) =>
      candidate.properties.path === filePath &&
      allowedTypes.includes(candidate.type) &&
      candidate.properties.startLine !== undefined &&
      candidate.properties.endLine !== undefined &&
      candidate.properties.startLine <= line &&
      candidate.properties.endLine >= line &&
      (candidate.properties.startLine !== line ||
        candidate.properties.startColumn === undefined ||
        candidate.properties.startColumn <= column) &&
      (candidate.properties.endLine !== line ||
        candidate.properties.endColumn === undefined ||
        candidate.properties.endColumn >= column),
  );
  candidates.sort(
    (a, b) =>
      a.properties.endLine! -
      a.properties.startLine! -
      (b.properties.endLine! - b.properties.startLine!),
  );
  return candidates[0]?.id;
}

function moduleSpecifier(statement: Parser.SyntaxNode): string | undefined {
  const match = statement.text.match(/(?:from\s*|import\s*)["']([^"']+)["']/);
  return match?.[1];
}

function resolveFilePath(
  fromPath: string,
  specifier: string,
  fileIds: Map<string, string>,
): string | undefined {
  if (!specifier.startsWith(".")) return undefined;
  const base = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromPath), specifier),
  );
  const candidates = [
    base,
    ...SOURCE_EXTENSIONS.map((extension) => `${base}${extension}`),
    ...SOURCE_EXTENSIONS.map((extension) => `${base}/index${extension}`),
  ];
  return candidates.find((candidate) => fileIds.has(candidate));
}

function importBindings(
  statement: Parser.SyntaxNode,
  targetFileId: string,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();
  const text = statement.text.replace(/\s+/g, " ");
  const named = text.match(/\{([^}]*)\}/)?.[1];
  if (named) {
    for (const item of named.split(",")) {
      const [imported, local = imported] = item.trim().split(/\s+as\s+/);
      if (imported)
        bindings.set(local.trim(), {
          targetFileId,
          symbolName: imported.trim(),
        });
    }
  }
  const namespace = text.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/)?.[1];
  if (namespace) bindings.set(namespace, { targetFileId });

  const defaultMatch = text.match(/^import\s+([A-Za-z_$][\w$]*)\s*(?:,|from)/);
  if (defaultMatch)
    bindings.set(defaultMatch[1], { targetFileId, symbolName: "default" });
  return bindings;
}

function callName(node: Parser.SyntaxNode): string | undefined {
  const callable =
    node.childForFieldName("function") ??
    node.childForFieldName("constructor") ??
    node.namedChildren[0];
  if (!callable) return undefined;
  if (callable.type === "identifier" || callable.type === "type_identifier")
    return callable.text;
  if (callable.type === "member_expression") {
    return callable.childForFieldName("property")?.text;
  }
  return undefined;
}

/** Adds resolved cross-reference edges after every file's declarations exist. */
export function extractRelationships(
  graph: CodeGraph,
  files: ParsedFile[],
): void {
  const seen = new Set(
    graph.relationships.map(
      (edge) => `${edge.from}\u0000${edge.type}\u0000${edge.to}`,
    ),
  );
  const fileIds = new Map<string, string>();
  const symbolsByFile = new Map<string, Map<string, GraphNode[]>>();
  const symbolsByName = new Map<string, GraphNode[]>();

  for (const node of graph.nodes) {
    if (node.type === "File" && node.properties.path)
      fileIds.set(node.properties.path, node.id);
    if (!node.properties.path || !node.properties.name) continue;
    const fileSymbols =
      symbolsByFile.get(node.properties.path) ?? new Map<string, GraphNode[]>();
    const sameName = fileSymbols.get(node.properties.name) ?? [];
    sameName.push(node);
    fileSymbols.set(node.properties.name, sameName);
    symbolsByFile.set(node.properties.path, fileSymbols);
    const globallyNamed = symbolsByName.get(node.properties.name) ?? [];
    globallyNamed.push(node);
    symbolsByName.set(node.properties.name, globallyNamed);
  }

  const resolveSymbol = (
    filePath: string,
    name: string,
    bindings: Map<string, ImportBinding>,
  ): GraphNode | undefined => {
    const local = symbolsByFile.get(filePath)?.get(name);
    if (local?.length === 1) return local[0];
    const binding = bindings.get(name);
    if (binding) {
      if (!binding.symbolName)
        return graph.nodes.find((node) => node.id === binding.targetFileId);
      const importedFile = graph.nodes.find(
        (node) => node.id === binding.targetFileId,
      )?.properties.path;
      const imported = importedFile
        ? symbolsByFile.get(importedFile)?.get(binding.symbolName)
        : undefined;
      return imported?.length === 1
        ? imported[0]
        : graph.nodes.find((node) => node.id === binding.targetFileId);
    }
    const global = symbolsByName.get(name);
    return global?.length === 1 ? global[0] : undefined;
  };

  for (const file of files) {
    const fileId = fileIds.get(file.relativePath);
    if (!fileId) continue;
    const bindings = new Map<string, ImportBinding>();

    const visit = (node: Parser.SyntaxNode): void => {
      if (node.type === "import_statement") {
        const specifier = moduleSpecifier(node);
        if (specifier) {
          const resolvedPath = resolveFilePath(
            file.relativePath,
            specifier,
            fileIds,
          );
          let targetFileId = resolvedPath
            ? fileIds.get(resolvedPath)!
            : `module:${specifier}`;
          if (
            !resolvedPath &&
            !graph.nodes.some((candidate) => candidate.id === targetFileId)
          ) {
            graph.nodes.push({
              id: targetFileId,
              type: "ExternalModule",
              properties: { name: specifier },
            });
          }
          addRelationship(graph, seen, fileId, "IMPORTS", targetFileId);
          for (const [name, binding] of importBindings(node, targetFileId))
            bindings.set(name, binding);
        }
        return;
      }

      if (
        node.type === "class_declaration" ||
        node.type === "interface_declaration"
      ) {
        const source = sourceForNode(graph.nodes, file.relativePath, node, [
          node.type === "class_declaration" ? "Class" : "Interface",
        ]);
        if (source) {
          const clauses: Parser.SyntaxNode[] = [];
          const collectClauses = (candidate: Parser.SyntaxNode): void => {
            if (
              [
                "extends_clause",
                "extends_type_clause",
                "implements_clause",
              ].includes(candidate.type)
            ) {
              clauses.push(candidate);
              return;
            }
            for (const child of candidate.namedChildren) collectClauses(child);
          };
          for (const child of node.namedChildren) collectClauses(child);
          for (const child of clauses) {
            const edgeType: RelationshipType | undefined =
              child.type === "extends_clause" ||
              child.type === "extends_type_clause"
                ? "EXTENDS"
                : child.type === "implements_clause"
                  ? "IMPLEMENTS"
                  : undefined;
            if (!edgeType) continue;
            for (const typeNode of child.namedChildren) {
              const target = resolveSymbol(
                file.relativePath,
                typeNode.text,
                bindings,
              );
              if (target)
                addRelationship(graph, seen, source, edgeType, target.id);
            }
          }
        }
      }

      if (node.type === "call_expression" || node.type === "new_expression") {
        const source = sourceForNode(graph.nodes, file.relativePath, node, [
          "Function",
          "Method",
        ]);
        const name = callName(node);
        const target = name
          ? resolveSymbol(file.relativePath, name, bindings)
          : undefined;
        if (
          source &&
          target &&
          ["Function", "Method", "Class"].includes(target.type)
        ) {
          addRelationship(graph, seen, source, "CALLS", target.id);
        }
      }

      if (node.type === "identifier" && !isWithin(node, "import_statement")) {
        const isDeclarationName =
          node.parent?.childForFieldName("name")?.id === node.id;
        const isCallTarget =
          isWithin(node, "call_expression") || isWithin(node, "new_expression");
        const isHeritage =
          isWithin(node, "extends_clause") ||
          isWithin(node, "implements_clause");
        if (!isDeclarationName && !isCallTarget && !isHeritage) {
          const source =
            sourceForNode(graph.nodes, file.relativePath, node, [
              "Function",
              "Method",
              "Class",
              "Interface",
            ]) ?? fileId;
          const target = resolveSymbol(file.relativePath, node.text, bindings);
          if (target) addRelationship(graph, seen, source, "USES", target.id);
        }
      }

      for (const child of node.namedChildren) visit(child);
    };
    visit(file.tree.rootNode);
  }
}
