import { detectLanguageFromPath } from "@xberg-io/tree-sitter-language-pack";


export function detectLanguage(filePath:string):string | null{
    return detectLanguageFromPath(filePath);
}