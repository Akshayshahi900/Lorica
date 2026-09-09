import { CodeGraph } from "@lorica/types";
import Parser from "tree-sitter";

export function extractFile(
    tree:Parser.Tree,
    relativePath:string
):CodeGraph{
    const graph:CodeGraph = {
        nodes:[],
        relationships:[],
    }
    // create File node

    // traverse tree

    // identify classes

    // identify functions

    // identify methods

    // identify imports
    return graph;
}