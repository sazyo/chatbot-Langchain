

import { PromptTemplate } from "@langchain/core/prompts";
import { ChatGroq } from "@langchain/groq";
import dotenv from "dotenv";
dotenv.config();


const model = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.1-8b-instant",
  temperature: 0.5,
});

const prompt = new PromptTemplate({
  template: "Tell me a joke about {topic}",
  inputVariables: ["topic"],
});

const formatted = await prompt.format({ topic: "cats" });

console.log("Formatted Prompt:", formatted);