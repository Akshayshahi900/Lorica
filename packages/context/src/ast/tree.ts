import {getParser} from "@xberg-io/tree-sitter-language-pack"


export function parseSource(source:string ,language:string){
    const parser = getParser(language);
    const tree = parser.parse(source);

    return tree;
}
