import { callLLM, REVIEW_PROMPT } from "@lorica/llm";
import {ReviewResult, ReviewContext} from "../../../types/src/types";
export async function reviewDiff(reviewContext: ReviewContext):Promise<ReviewResult>{
    const raw = await callLLM(reviewContext , REVIEW_PROMPT);
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
