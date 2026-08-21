import { detectLanguage } from "@xberg-io/tree-sitter-language-pack";
import { parseSource } from "./tree";


export function parseFile(
    path:string,
    source:string
){
    const language = detectLanguage(path);
    if(!language){
        return null;
    }

    const tree = parseSource(source , language);

    return {
        path , language , tree
    };
}