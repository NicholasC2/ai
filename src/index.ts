import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output, stdout } from "node:process";

import { Ollama, ToolCall, type Message } from "ollama";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

import colors from "colors";

const DATA_FOLDER = "./data"
const MEMORY_FILE = "./data/memories.txt"

const SHOW_THINKING = false;

const rl = createInterface({ input, output });

const ollama = new Ollama();

const tools = [
    {
        type: "function" as const,
        function: {
            name: "exec",
            description: "Execute a command on my pc(cachyos latest x86_64)",
            parameters: {
                type: "object",
                properties: {
                    command: {
                        type: "string",
                        description: "Command to execute"
                    }
                },
                required: ["command"]
            }
        }
    },

    {
        type: "function" as const,
        function: {
            name: "remember",
            description: "Save perminant important information about the user, for example user preferences",
            parameters: {
                type: "object",
                properties: {
                    content: {
                        type: "string",
                        description: "The information to remember"
                    }
                },
                required: ["content"]
            }
        }
    },

    {
        type: "function" as const,
        function: {
            name: "websearch",
            description: "searches the web and returns the results",
            parameters: {
                type: "object",
                properties: {
                    query: {
                        type: "string",
                        description: "the search query"
                    }
                },
                required: ["query"]
            }
        }
    }

];

async function executeTool(call: ToolCall["function"]) {
    switch (call.name) {
        case "exec": {
            const command = call.arguments.command;

            if (typeof command !== "string") {
                throw new Error("exec requires a string command");
            }


            console.log(`$ ${command}`)
            if(!(await rl.question("Run? [Y/n]")).toLowerCase().includes("n")) {
                const commandResult = execSync(command).toString();

                console.log(commandResult)

                return String(commandResult);
            }

            return String("User rejected command run");
        }

        case "remember": {
            const content = call.arguments.content

            if (typeof content !== "string") {
                throw new Error("remember requires a string content");
            }

            appendFileSync(MEMORY_FILE, "\n" + content.replaceAll("\n", " "));

            return "saved succesfully"
        }

        case "websearch": {
            const query = call.arguments.query

            if (typeof query !== "string") {
                throw new Error("websearch requires a string query");
            }

            const res = await fetch(`https://etsi.me/search?q=${encodeURIComponent(query)}&format=json`);

            return await res.text();
        }

        default:
            throw new Error(`Unknown tool: ${call.name}`);
    }
}

async function main() {
    if (!existsSync(DATA_FOLDER)) {
        mkdirSync(DATA_FOLDER);
    }

    if (!existsSync(MEMORY_FILE)) {
        writeFileSync(MEMORY_FILE, "");
    }

    let messages = [];

    while (true) {
        const userInput = await rl.question("> ");

        if (!userInput.trim()) continue;

        messages.push({
            role: "user",
            content: userInput
        });

        while (true) {
            const response = await ollama.chat({
                model: "qwen3:latest",
                think: "low",
                messages: [
                    ...messages,
                    {
                        role: "memories",
                        content: readFileSync(MEMORY_FILE, "utf8")
                    }
                ],
                tools,
                stream: true
            });

            let assistantContent = "";
            let assistantThinking = "";
            let toolCalls: ToolCall[] = [];

            for await (const part of response) {
                assistantThinking += part.message.thinking ?? "";
                assistantContent += part.message.content ?? "";

                if (part.message.thinking) {
                    if(SHOW_THINKING) {
                        process.stdout.write(colors.grey(part.message.thinking));
                    }
                }

                process.stdout.write(part.message.content);

                if (part.message.tool_calls) {
                    toolCalls.push(...part.message.tool_calls);
                }

                if (part.done) break;
            }

            console.log("\n");

            messages.push({
                role: "assistant",
                content: assistantContent,
                thinking: assistantThinking,
                tool_calls: toolCalls
            });

            if (toolCalls.length === 0) {
                break;
            }

            for (const toolCall of toolCalls) {
                const result = await executeTool(toolCall.function);

                messages.push({
                    role: "tool",
                    content: result
                });
            }
        }
    }
}

main().catch((err) => {
    if (err?.code === "ABORT_ERR") {
        process.stdout.write("\n");
        process.exit(0);
    }

    console.error(err);
});
