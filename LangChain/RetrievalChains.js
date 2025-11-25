import { ChatGroq } from "@langchain/groq";
import { MemoryVectorStore } from "@langchain/classic/vectorstores/memory";
import { PDFLoader } from "@langchain/community/document_loaders/fs/pdf";
import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { pipeline } from "@xenova/transformers";
import dotenv from "dotenv";
dotenv.config();


class XenovaEmbeddings {
  constructor(modelName = "Xenova/all-MiniLM-L6-v2") {
    this.modelName = modelName;
  }

  async init() {
    this.embedder = await pipeline("feature-extraction", this.modelName);
  }

  async embedQuery(text) {
    const output = await this.embedder(text, { pooling: "mean", normalize: true });
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


let vectorStore;
let model;

async function extractPDFInfo() {
  const loader = new PDFLoader("docs/file.pdf");
  const docs = await loader.load();

  if (docs.length === 0) {
    console.log("No documents found.");
    return;
  }

  const textSplitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1000,
    chunkOverlap: 200,
  });

  const documents = await textSplitter.splitDocuments(docs);


  const embeddings = new XenovaEmbeddings();
  await embeddings.init(); 

  vectorStore = await MemoryVectorStore.fromDocuments(documents, embeddings);


  model = new ChatGroq({
    apiKey: process.env.GROQ_API_KEY,
    model: "llama-3.1-8b-instant",
    temperature: 0.2,
  });

  const question = "name this company";
  const answer = await askQuestion(question);
  console.log("\nQuestion:", question);
  console.log("\nAnswer:", answer);
}


async function askQuestion(question) {
  const results = await vectorStore.similaritySearch(question, 4);
  const context = results.map(r => r.pageContent).join("\n\n");

  const promptTemplate = new PromptTemplate({
    template: `Answer ONLY using this context:

{context}

QUESTION: {question}

ANSWER:`,
    inputVariables: ["question", "context"],
  });

  const outputParser = new StringOutputParser();
  const chain = promptTemplate.pipe(model).pipe(outputParser);

  return chain.invoke({ question, context });
}


extractPDFInfo().catch(console.error);
