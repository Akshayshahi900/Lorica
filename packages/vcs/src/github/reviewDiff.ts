import { callLLM } from "../../llm/client"
import { REVIEW_PROMPT } from "../../llm/prompt"
import {ReviewResult} from "../../types/types";
export async function reviewDiff(diffText :string):Promise<ReviewResult>{
    const raw = await callLLM(diffText , REVIEW_PROMPT);
    let result:ReviewResult;
    
    try{
        result = raw;
    }catch{
        throw new Error(`LLM returned invalid JSON:\n${raw}`);
    }

    if(!result || !Array.isArray(result.reviews)){
        throw new Error("Invalid review result: reviews[] missing");
    }

    return result;

}