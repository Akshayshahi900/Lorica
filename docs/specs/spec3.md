# Code-index relationship expansion

## Purpose

Extend the code graph beyond declaration ownership so repository navigation and
impact analysis can follow module dependencies, inheritance, interface
contracts, calls, and symbol references.

The relationship direction is always `from -> to`: the source is the AST node
that expresses the relationship and the target is the referenced graph node.

| Type         | Direction                               | Meaning                                                           |
| ------------ | --------------------------------------- | ----------------------------------------------------------------- |
| `CONTAINS`   | Repository -> File                      | The repository owns an indexed source file.                       |
| `DEFINES`    | File/Class/Interface -> declared symbol | The source declares the target symbol.                            |
| `IMPORTS`    | File -> File or external module         | The file imports from the target module.                          |
| `CALLS`      | Function/Method -> Function/Method      | The caller invokes the target callable.                           |
| `EXTENDS`    | Class/Interface -> Class/Interface      | The source inherits from the target base type.                    |
| `IMPLEMENTS` | Class -> Interface                      | The class implements the target interface.                        |
| `USES`       | Symbol -> Symbol                        | A non-call reference from the source symbol to the target symbol. |

`USES` is deliberately the fallback reference edge. Do not also emit `USES`
for a reference already represented by `CALLS`, `EXTENDS`, or `IMPLEMENTS`.

## Current implementation

`packages/types/src/types.ts` declares the relationship union, but only
`CONTAINS` and `DEFINES` are active. The desired new values are presently
commented out:

```ts
export type RelationshipType =
  | "CONTAINS"
  | "DEFINES"
  | "IMPORTS"
  | "CALLS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "USES";
```

The indexing flow is:

1. `discoverFiles.ts` finds `.ts`, `.tsx`, `.js`, and `.jsx` files, excluding
   generated/dependency directories.
2. `parser.ts` parses every discovered file with the TypeScript Tree-sitter
   grammar (including JS-family files).
3. `codeIndex.worker.ts` invokes `extractFile(tree, relativePath)` for each
   file and concatenates the resulting nodes and relationships.
4. `extractFile.ts` creates one File node and walks the AST. It currently
   recognizes class declarations, interface declarations, function
   declarations, and method definitions. Each recognised declaration produces
   a `DEFINES` relationship from its containing File or Class.
5. `neo4j.ts` stores File nodes beneath a Repository through `:CONTAINS`.

There is a persistence defect that must be fixed as part of this work:
`neo4j.ts` ignores `row.type` and executes `MERGE (source)-[:DEFINES]->(target)`
for _every_ `graph.relationships` entry. Consequently, simply expanding the
TypeScript union or emitting an `IMPORTS` edge will still store it as
`:DEFINES` in Neo4j.

## Required graph-model changes

### Node targets and resolution

Relationships may only be persisted when both endpoints have graph nodes.
The indexer must therefore first create its file and declaration nodes, build
lookup tables, then resolve reference edges.

Required lookups:

- File by repository-relative path, including extension/index-file resolution
  for relative imports.
- Symbol by containing file and name.
- Member by owning class/interface and name.
- Imported local-name/alias to its exported symbol or module.
- Type name in lexical scope for extends/implements resolution.

An import of a repository file should target its File node. For package or
otherwise unresolved imports, introduce an explicit external-module node
(for example `module:npm:react`) and extend `NodeType` accordingly. Do not
create an `IMPORTS` edge to a missing node. The same rule applies to calls and
type references: unresolved references should be counted/logged for later
diagnostics rather than guessed.

### AST extraction rules

Run extraction in two passes per repository:

1. **Declaration pass**: preserve the existing File, Class, Interface,
   Function, and Method nodes and their `DEFINES` ownership edges.
2. **Reference pass**: inspect AST nodes once all declarations are available
   and emit the following resolved relationships.

| AST construct                                       | Edge emitted | Source                              | Target                                                  |
| --------------------------------------------------- | ------------ | ----------------------------------- | ------------------------------------------------------- |
| `import_statement` / import specifier               | `IMPORTS`    | File                                | resolved File or external module                        |
| class `extends` clause                              | `EXTENDS`    | Class                               | resolved Class                                          |
| interface `extends` clause                          | `EXTENDS`    | Interface                           | resolved Interface                                      |
| class `implements` clause                           | `IMPLEMENTS` | Class                               | resolved Interface                                      |
| `call_expression` / `new_expression`                | `CALLS`      | enclosing Function or Method        | resolved Function, Method, or constructor-capable Class |
| identifier/member reference outside the cases above | `USES`       | enclosing declared symbol (or File) | resolved declaration                                    |

For initial scope, resolve only unambiguous same-file and relative-import
references. Keep aliases (`import { foo as bar }`) in the per-file symbol
table. Cross-package type checking, dynamic calls, computed property access,
and reflection can remain unresolved until a later phase.

Use deterministic IDs. Existing declaration IDs are path-and-name based;
overloads, anonymous functions, duplicate names in scopes, and constructors
need a stable positional suffix (such as start line/column) before call
resolution is dependable.

## Neo4j persistence requirements

Persist the edge type actually present in `GraphRelationship.type`. Because a
Cypher relationship type cannot safely be interpolated from untrusted input,
validate each type against the `RelationshipType` allowlist before selecting
the Cypher statement. Then `MERGE` the corresponding typed relationship
between matched, repository-scoped nodes. This retains graph traversal
semantics such as:

```cypher
MATCH (file:CodeGraphNode {id: $fileId})-[:IMPORTS]->(dependency)
RETURN dependency
```

Alternatively, a single fixed Neo4j relationship label (for example
`:RELATIONSHIP`) plus a validated `type` property is acceptable only if query
performance and traversal ergonomics are explicitly preferred over native
Neo4j relationship labels. The current implementation uses native labels for
`CONTAINS` and `DEFINES`, so native labels for all seven types are the
consistent choice.

All relationship matches must continue to include `repositoryKey`; symbols
with identical IDs in different indexed repositories or branches must never
be connected. Re-indexing should still remove old `CodeGraphNode` nodes and
their relationships before writing the replacement graph.

## Validation and acceptance criteria

- `RelationshipType` contains all seven values above with no commented-out
  variants.
- An indexed fixture with local and package imports produces `IMPORTS` edges
  with valid endpoints.
- A fixture with inheritance and implementation produces `EXTENDS` and
  `IMPLEMENTS` edges in both the returned `CodeGraph` and Neo4j.
- A fixture with direct and imported function calls produces resolved `CALLS`
  edges; unrelated references use `USES` at most once per source/target/type.
- Neo4j relationship labels match `GraphRelationship.type`; no non-`DEFINES`
  relationship is silently persisted as `:DEFINES`.
- Existing smoke-test checks remain true: unique node IDs and no relationship
  whose endpoint is absent from `graph.nodes`.
- Add focused extractor/resolver tests rather than relying only on the queue
  smoke test. Include aliases, nested methods, unresolved imports, and
  duplicate names in different files/scopes.

## Implementation order

1. Activate the union values and add any required external-module node kind.
2. Refactor extraction into declaration collection plus repository-level
   resolution, keeping `extractFile` side-effect free.
3. Implement `IMPORTS`, then `EXTENDS` and `IMPLEMENTS`, followed by `CALLS`
   and `USES`.
4. Change Neo4j persistence to retain validated relationship types.
5. Add fixtures/tests and verify the emitted graph plus the stored Neo4j
   relationships.
