export type ReviewFinding = {
    filePath:string;
    lineNumber:number;
    code:string;
    severity:"critical" | "high" | "medium" | "low";
    category:
    | "bug"
    | "security"
    | "performance"
    | "correctness"
    | "maintainability";
    comment:string;
    suggestion?:string;
}

export type  ReviewResult = {
    summary:string;
    reviews:ReviewFinding[];
}

