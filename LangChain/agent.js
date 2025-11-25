import dotenv from "dotenv";
dotenv.config();
import readline from "readline";
import { ChatGroq } from "@langchain/groq";
import {ChatPromptTemplate,} from "@langchain/core/prompts";
import { HumanMessage, AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { CheerioWebBaseLoader } from "@langchain/community/document_loaders/web/cheerio";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { pipeline } from "@xenova/transformers";
import { z } from "zod";


import express from "express";
import cors from "cors";


const chat_history = [];


const app = express();
app.use(cors());
app.use(express.json());

app.post("/ask", async (req, res) => {
  const question = req.body.question;
  if (question == "exit") {
    res.json({ answer: "Session ended." });
    process.exit(0);
    
  }
  if (!question || question.trim() === "") {
    res.json({ error: "No question provided." });
    return;
  }
  
  try {
    const answer = await runAgent(question, chat_history);
    
    chat_history.push(new HumanMessage(question));
    chat_history.push(new AIMessage(answer));
    
    res.json({ answer });
  } catch (err) {
    res.json({ error: err.message });
  }
});

app.listen(5000, () => {
  console.log("API running on http://localhost:5000");
});

class XenovaEmbeddings {
  constructor(modelName = "Xenova/all-MiniLM-L6-v2") {
    this.modelName = modelName;
  }

  async init() {
    this.embedder = await pipeline("feature-extraction", this.modelName);
  }

  async embedQuery(text) {
    const output = await this.embedder(text, {
      pooling: "mean",
      normalize: true,
    });
    return Array.from(output.data);
  }

  async embedDocuments(documents) {
    const vectors = [];
    for (const doc of documents) {
      vectors.push(await this.embedQuery(doc.pageContent || doc));
    }
    return vectors;
  }
}

console.log("Loading documents...");
const loader = new CheerioWebBaseLoader(
  "https://en.wikipedia.org/wiki/Apple_Inc."
);
const docs = await loader.load();

const splitter = new RecursiveCharacterTextSplitter({
  chunkSize: 500,  
  chunkOverlap: 50, 
});

const splitDocs = await splitter.splitDocuments(docs);

console.log("Initializing embeddings...");
const embeddings = new XenovaEmbeddings();
await embeddings.init();

console.log("Creating vector store...");
const vectorStore = await MemoryVectorStore.fromDocuments(
  splitDocs,
  embeddings
);

const retriever = vectorStore.asRetriever({
  k: 4,  
});

const model = new ChatGroq({
  apiKey: process.env.GROQ_API_KEY,
  model: "llama-3.1-8b-instant",
  temperature: 0.2,
});

const modelWithTools = model.bindTools([
  {
    type: "function",
    function: {
      name: "tavily_search",
      description: "Search the web for current information",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "apple_search",
      description:
        "Search for information about Apple Inc. from the website en.wikipedia.org/wiki/Apple_Inc.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query",
          },
        },
        required: ["query"],
      },
    },
  },
]);

const searchTool = new DynamicStructuredTool({
  name: "tavily_search",
  description: "Search the web for current information",
  schema: z.object({
    query: z.string().describe("The search query"),
  }),
  func: async ({ query }) => {
    try {
      const response = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          api_key: process.env.TAVILY_API_KEY,
          query: query,
          max_results: 5,
        }),
      });
      const data = await response.json();
      return data.results
        .map((r) => `${r.title}: ${r.content}`)
        .join("\n\n");
    } catch (error) {
      return `Search error: ${error.message}`;
    }
  },
});



const AppleTool = new DynamicStructuredTool({
  name: "apple_search",
  description:
    "Search for information about Apple Inc. from the website en.wikipedia.org/wiki/Apple_Inc.",
  schema: z.object({
    query: z.string().describe("The search query"),
  }),
  func: async ({ query }) => {
    const results = await retriever.invoke(query);
    const content = results.map((doc) => doc.pageContent).join("\n\n");
    
    // Return more informative message if content is too short
    if (content.length < 50) {
      return "Limited information available from aeliasoft.com. The website contains basic information about Aeliasoft Services.";
    }
    
    return content;
  },
});

const tools = {
  tavily_search: searchTool,
  apple_search: AppleTool,
};

const toolCallHistory = new Map();

async function runAgent(input, chatHistory) {
  toolCallHistory.clear();
  
  const prompt = ChatPromptTemplate.fromMessages([
    [
      "system",
      "You are a helpful assistant. Use the available tools when needed. " +
      "Use tavily_search for general web searches and current information. " +
      "Use apple_search for questions about Apple Inc. company. " +
      "IMPORTANT: Only call each tool ONCE per user query. After getting tool results,  provide your answer based on the information received. " +
      "If the information is limited, say so and provide what you have."
    ],
    ...chatHistory,
    ["human", "{input}"],
  ]);

  let response = await prompt.pipe(modelWithTools).invoke({ input });
  
  const maxIterations = 3; 
  let iterations = 0;
  
  while (response.tool_calls && response.tool_calls.length > 0 && iterations < maxIterations) {
    iterations++;
    
    const toolMessages = [];
    
    for (const toolCall of response.tool_calls) {
      const toolName = toolCall.name;
      const toolArgs = toolCall.args;
      
      const toolKey = `${toolName}:${toolArgs.query}`;
      
      if (toolCallHistory.has(toolKey)) {
        console.log(`\n[Skipping duplicate tool call: ${toolName}]`);
        continue;
      }
      
      toolCallHistory.set(toolKey, true);
      
      console.log(`\n[Using tool: ${toolName} with query: "${toolArgs.query}"]`);
      
      if (tools[toolName]) {
        try {
          const result = await tools[toolName].invoke(toolArgs);
          console.log(`[Tool result preview: ${result.substring(0, 100)}...]`);
          
          toolMessages.push(
            new ToolMessage({
              content: typeof result === 'string' ? result : JSON.stringify(result),
              tool_call_id: toolCall.id,
              name: toolName,
            })
          );
        } catch (error) {
          console.log(`[Tool error: ${error.message}]`);
          toolMessages.push(
            new ToolMessage({
              content: `Error: ${error.message}`,
              tool_call_id: toolCall.id,
              name: toolName,
            })
          );
        }
      }
    }
    
    if (toolMessages.length === 0) {
      break;
    }
    
    const messagesWithTools = [
      [
        "system", 
        "You are a helpful assistant. Based on the tool results you received, provide a clear answer to the user. " +
        "Do NOT call tools again - use the information you already have."
      ],
      ...chatHistory,
      ["human", input],
      response,
      ...toolMessages,
    ];
    
    const continuePrompt = ChatPromptTemplate.fromMessages(messagesWithTools);
    response = await continuePrompt.pipe(modelWithTools).invoke({});
  }
  
  return response.content;
}

/*
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
 

console.log("\nAgent ready! Type 'exit' to quit.\n");

function askQuestion() {
  rl.question("User: ", async (input) => {
    if (input.toLowerCase() === "exit") {
      rl.close();
      return;
    }

    try {
      const response = await runAgent(input, chat_history);
      
      console.log("\nAgent:", response);

      chat_history.push(new HumanMessage(input));
      chat_history.push(new AIMessage(response));
    } catch (error) {
      console.error("Error:", error.message);
    }

    askQuestion();
  });
}

askQuestion();
*/