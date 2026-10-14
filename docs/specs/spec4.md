# Implemented code-graph relationship expansion

## Summary

The code indexer now supports all requested semantic relationship types in
addition to the existing declaration graph:

| Relationship | Source -> target                               | Implementation status                         |
| ------------ | ---------------------------------------------- | --------------------------------------------- |
| `CONTAINS`   | Repository -> File                             | Existing behavior retained.                   |
| `DEFINES`    | File/Class/Interface -> declared symbol        | Existing behavior retained.                   |
| `IMPORTS`    | File -> File or ExternalModule                 | Implemented.                                  |
| `CALLS`      | Function/Method -> Function/Method/Class       | Implemented for resolved calls.               |
| `EXTENDS`    | Class/Interface -> Class/Interface             | Implemented.                                  |
| `IMPLEMENTS` | Class -> Interface                             | Implemented.                                  |
| `USES`       | Declared symbol/File -> referenced declaration | Implemented for resolved non-call references. |

## Type-system changes

`packages/types/src/types.ts` now activates `IMPORTS`, `CALLS`, `EXTENDS`,
`IMPLEMENTS`, and `USES` in `RelationshipType`.

`NodeType` now also contains `ExternalModule`. This allows package imports
such as `import "react"` to point to a real graph node rather than creating a
relationship with a missing endpoint.

Graph nodes now retain `startColumn` and `endColumn` alongside line ranges.
This lets the resolver identify the correct containing function or method when
multiple declarations occur on the same source line.

## Indexing pipeline changes

`apps/worker/src/codeIndex.worker.ts` still discovers source files, parses
them, and calls `extractFile` for declaration nodes and `DEFINES` edges. It
now preserves every parsed file's Tree-sitter tree and runs a repository-wide
second pass after all declarations have been collected:

```text
discover files
  -> parse each file
  -> extract File/Class/Interface/Function/Method declarations
  -> combine all declaration graphs
  -> resolve cross-reference relationships
  -> persist the complete graph
```

The second pass is implemented in
`apps/worker/src/indexer/relationships.ts`. Delaying reference resolution
until all files are indexed makes local and relative-import references
resolvable regardless of file-discovery order.

## Relationship resolution

### Imports

For each Tree-sitter `import_statement`, the resolver reads the module
specifier and emits one deduplicated `IMPORTS` edge from the importing File.

- Relative imports are resolved against repository-relative paths using
  `.ts`, `.tsx`, `.js`, `.jsx`, and `index`-file candidates.
- Resolved relative imports target the repository File node.
- Package and unresolvable imports target a shared `ExternalModule` node with
  an ID such as `module:react`.
- Named aliases such as `import { helper as runHelper } from "./helper"` are
  kept in the per-file import-binding table for subsequent call/reference
  resolution.

### Extends and implements

The resolver scans class and interface declarations for Tree-sitter
inheritance clauses:

- class `extends_clause` -> `EXTENDS`
- interface `extends_type_clause` -> `EXTENDS`
- class `implements_clause` -> `IMPLEMENTS`

Targets are resolved first within the file, then through imports, then only
when the repository has one unambiguous symbol with that name.

### Calls

For `call_expression` and `new_expression` nodes, the resolver finds the
enclosing Function or Method and emits `CALLS` when the callee resolves to a
Function, Method, or Class. It supports direct identifiers and member-call
property names. Calls that are dynamic, computed, ambiguous, or unresolved do
not produce guessed edges.

### Uses

For identifier references that are not declaration names, imports, call
targets, or inheritance references, the resolver emits `USES` from the
nearest enclosing Function, Method, Class, or Interface. If no declared
container exists, the source is the File. `USES` is deduplicated and is not
emitted alongside a more specific call or type relationship.

## Persistence changes

Previously, `apps/worker/src/neo4j.ts` persisted every in-memory relationship
as `:DEFINES`, even when the graph relationship said otherwise.

Persistence now iterates a fixed allowlist of the six non-repository edge
labels (`DEFINES`, `IMPORTS`, `CALLS`, `EXTENDS`, `IMPLEMENTS`, and `USES`) and
executes a static Cypher `MERGE` for each populated type. This preserves native
Neo4j relationship labels while avoiding dynamic Cypher-label interpolation
from graph data. Repository-to-File `CONTAINS` persistence remains part of the
node write query.

All relationship matches remain scoped by `repositoryKey`, preventing edges
between repositories or branches with similarly named symbols.

## Tests and verification

`apps/worker/src/test.ts` now starts by executing a small in-memory fixture
that verifies:

- local and external `IMPORTS`;
- `EXTENDS` and `IMPLEMENTS` from a class hierarchy;
- an imported helper `CALLS` edge from a method; and
- a non-call helper reference represented by `USES`.

The fixture also validates that every relationship endpoint appears in
`graph.nodes` and confirms the external package node exists.

`pnpm test:index` was run. The new relationship fixture passed. The queue
smoke test then parsed the repository and constructed a graph, but could not
finish persistence because the current environment does not define
`NEO4J_URI`, `NEO4J_USER`, and `NEO4J_PASSWORD`. Supplying those values is
required for the existing end-to-end Neo4j smoke test to complete.

`git diff --check` also passed.

## Deliberate resolution limits

The implementation resolves unambiguous same-file and relative-import
symbols. It does not infer targets for dynamic dispatch, computed properties,
reflection, overloaded names, or package type declarations. Those cases are
left without speculative edges so the graph remains trustworthy.
