import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";
dotenv.config();
const models = new ChatGroq({
    
   // apiKey: process.env.groq_api_key,
    model: "llama-3.1-8b-instant",
    temperature: 0.5,
    verbose: true,
    maxTokens: 1024,

})

const res = await models.invoke("hello ");
console.log(res);