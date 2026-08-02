// apps/api/src/github/parseDiff.ts
import parseDiff from 'parse-diff';
import type { FileDiff } from './fetchDiff';

export interface AddedLine {
  lineNumber: number; // line number in the NEW version of the file
  content: string;
}

export interface ParsedFileDiff {
  filePath: string;
  addedLines: AddedLine[];
}

export function parseFileDiffs(files: FileDiff[]): ParsedFileDiff[] {
  return files
    .filter((f) => f.patch) // skip binary/removed files with no patch
    .map((f) => {
      // parse-diff expects a full multi-file diff string; wrap a single
      // file's patch with minimal headers so it parses standalone.
      const wrapped = `diff --git a/${f.filePath} b/${f.filePath}\n${f.patch}`;
      const [parsed] = parseDiff(wrapped);

      const addedLines: AddedLine[] = [];
      for (const chunk of parsed?.chunks ?? []) {
        for (const change of chunk.changes) {
          if (change.type === 'add') {
            addedLines.push({
              lineNumber: change.ln, // 'ln' = line number in new file for additions
              content: change.content.slice(1), // strip leading '+' marker
            });
          }
        }
      }

      return { filePath: f.filePath, addedLines };
    });
}