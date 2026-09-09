import { CodeGraph } from "@lorica/types";
import Parser from "tree-sitter";

export function extractFile(
    tree: Parser.Tree,
    relativePath: string
): CodeGraph {

    const graph: CodeGraph = {
        nodes: [],
        relationships: [],
    };

    // 1. Create File node

    const fileId = `file:${relativePath}`;

    graph.nodes.push({
        id: fileId,
        type: "File",
        properties: {
            path: relativePath,
            language: "typescript",
            startLine: 1,
            endLine: tree.rootNode.endPosition.row + 1,
        },
    });

    // 2. Traverse AST

    function visit(
        node: Parser.SyntaxNode,
        parentId: string
    ): void {

        switch (node.type) {

            // Class

            case "class_declaration": {

                const nameNode =
                    node.childForFieldName("name");

                if (!nameNode) {
                    break;
                }

                const name = nameNode.text;

                const classId =
                    `class:${relativePath}:${name}`;

                graph.nodes.push({
                    id: classId,
                    type: "Class",
                    properties: {
                        name,
                        path: relativePath,
                        startLine:
                            node.startPosition.row + 1,
                        endLine:
                            node.endPosition.row + 1,
                    },
                });

                graph.relationships.push({
                    from: parentId,
                    type: "DEFINES",
                    to: classId,
                });

                // The class becomes the parent
                // of its methods.
                for (const child of node.namedChildren) {
                    visit(child, classId);
                }

                return;
            }

            // Interface

            case "interface_declaration": {

                const nameNode =
                    node.childForFieldName("name");

                if (!nameNode) {
                    break;
                }

                const name = nameNode.text;

                const interfaceId =
                    `interface:${relativePath}:${name}`;

                graph.nodes.push({
                    id: interfaceId,
                    type: "Interface",
                    properties: {
                        name,
                        path: relativePath,
                        startLine:
                            node.startPosition.row + 1,
                        endLine:
                            node.endPosition.row + 1,
                    },
                });

                graph.relationships.push({
                    from: parentId,
                    type: "DEFINES",
                    to: interfaceId,
                });

                break;
            }

            // Function

            case "function_declaration": {

                const nameNode =
                    node.childForFieldName("name");

                if (!nameNode) {
                    break;
                }

                const name = nameNode.text;

                const functionId =
                    `function:${relativePath}:${name}`;

                graph.nodes.push({
                    id: functionId,
                    type: "Function",
                    properties: {
                        name,
                        path: relativePath,
                        startLine:
                            node.startPosition.row + 1,
                        endLine:
                            node.endPosition.row + 1,
                    },
                });

                graph.relationships.push({
                    from: parentId,
                    type: "DEFINES",
                    to: functionId,
                });

                break;
            }

            // Method

            case "method_definition": {

                const nameNode =
                    node.childForFieldName("name");

                if (!nameNode) {
                    break;
                }

                const name = nameNode.text;

                const methodId =
                    `method:${relativePath}:${parentId}:${name}`;

                graph.nodes.push({
                    id: methodId,
                    type: "Method",
                    properties: {
                        name,
                        path: relativePath,
                        startLine:
                            node.startPosition.row + 1,
                        endLine:
                            node.endPosition.row + 1,
                    },
                });

                graph.relationships.push({
                    from: parentId,
                    type: "DEFINES",
                    to: methodId,
                });

                break;
            }
        }

        // Visit children
    
        for (const child of node.namedChildren) {
            visit(child, parentId);
        }
    }

    // Start traversal at root
    visit(tree.rootNode, fileId);

    return graph;
}