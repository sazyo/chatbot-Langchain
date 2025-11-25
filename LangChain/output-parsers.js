

import { PromptTemplate } from "@langchain/core/prompts";
import { ChatGroq } from "@langchain/groq";
import {StringOutputParser} from "@langchain/core/output_parsers";
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

const outputParser = new StringOutputParser();
const promptWithParser = prompt.pipe(model).pipe(outputParser);

const formatted = await prompt.format({ topic: "cats" });

console.log("Formatted Prompt:", formatted);
const response = await model.invoke(formatted);
console.log("Model Response:", response);