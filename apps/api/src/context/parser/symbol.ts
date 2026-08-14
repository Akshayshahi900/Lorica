import type { CodeSymbol } from "./types";

export function extractSymbols(root: any): CodeSymbol[] {
  const symbols: CodeSymbol[] = [];

  function visit(node: any, parent?: string) {
    const kind = node.kind();

    if (kind === "function_declaration") {
      const nameNode = node.childForFieldName("name");

      if (nameNode) {
        symbols.push({
          kind: "function",
          name: nameNode.text(),
          startLine: node.startPosition().row + 1,
          endLine: node.endPosition().row + 1,
          startColumn: node.startPosition().column,
          endColumn: node.endPosition().column,
          parent,
        });
      }
    }

    if (kind === "class_declaration") {
      const nameNode = node.childForFieldName("name");

      if (nameNode) {
        symbols.push({
          kind: "class",
          name: nameNode.text(),
          startLine: node.startPosition().row + 1,
          endLine: node.endPosition().row + 1,
          startColumn: node.startPosition().column,
          endColumn: node.endPosition().column,
          parent,
        });
      }
    }

    const currentParent =
      kind === "class_declaration" || kind === "function_declaration"
        ? node.childForFieldName("name")?.text()
        : parent;

    for (let i = 0; i < node.childCount(); i++) {
      const child = node.namedChild(i);

      if (child) {
        visit(child, currentParent);
      }
    }
  }

  visit(root);

  return symbols;
}