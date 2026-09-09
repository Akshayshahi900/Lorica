import Parser from "tree-sitter";
import Typescript from "tree-sitter-typescript";


const parser = new Parser();

parser.setLanguage(Typescript.typescript);

export function parseTypeScript(source:string){
    return parser.parse(source);
}