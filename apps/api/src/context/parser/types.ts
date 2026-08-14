export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "struct"
  | "interface"
  | "enum"
  | "variable"
  | "import"
  | "export";

export interface CodeSymbol {
  kind: SymbolKind;
  name: string;

  startLine: number;
  endLine: number;

  startColumn: number;
  endColumn: number;

  parent?: string;
}

export interface ParseDiagnostic {
  message: string;

  startLine: number;
  startColumn: number;

  endLine: number;
  endColumn: number;
}

export interface ParsedFile {
  path: string;
  language: string;

  symbols: CodeSymbol[];
  diagnostics: ParseDiagnostic[];

  tree: unknown;
}