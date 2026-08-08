export async function callLLM(diffText :string , promptTemplate:string){

  const response = await fetch("http://localhost:11434/api/chat" , {
    method:"POST",
    headers: {
      "Content-Type" : "application/json"
    },
    body:JSON.stringify({
      model: "qwen2.5-coder:7b",
      messages:[
        {role:"system" , content: promptTemplate},
        {role:"user" , content:diffText}
      ],
      stream:false,
      format:"json"
    })
    });
    return response;
}
