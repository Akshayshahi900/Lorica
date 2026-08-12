// apps/api/src/github/parseDiff.ts
import parseDiff from 'parse-diff';
import type { FileDiff } from './fetchDiff';

export interface DiffChange {
  type: 'add' | 'del' | 'normal';
  lineNumber?: number;
  oldLineNumber?: number;
  content: string;
}

export interface ParsedFileDiff {
  filePath: string;
  changes: DiffChange[];
}
export function parseFileDiffs(files: FileDiff[]): ParsedFileDiff[] {
  return files
    .filter((f) => f.patch)
    .map((f) => {
      const wrapped =
        `diff --git a/${f.filePath} b/${f.filePath}\n${f.patch}`;

      const [parsed] = parseDiff(wrapped);

      const changes: DiffChange[] = [];

      for (const chunk of parsed?.chunks ?? []) {
        for (const change of chunk.changes) {
          changes.push({
            type: change.type,
            lineNumber: change.ln,
            oldLineNumber: change.ln2,
            content: change.content,
          });
        }
      }

      return {
        filePath: f.filePath,
        changes,
      };
    });
}