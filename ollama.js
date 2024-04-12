// @ts-check
const { openiap } = require('@openiap/nodeapi');
const http = require('http');

/**
 * @typedef {Object} modelinfo
 * @property {string} modelfile
 * @property {string} parameters
 * @property {string} system
 * @property {string} template
 */
/**
 * @typedef {Object} chatmessage
 * @property {"user"|"assistant"|"system"|"tool"} role - The role of the message sender
 * @property {string} content - The message content
 */

const requests = [];
/**
 * 
 * @param {string} model 
 * @param {number} temperature 
 * @param {string} prompt 
 * @param {boolean} json 
 * @param {openiap | null} client
 * @param {string} streamto
 * @returns {Promise<string>} - The generated text
 */
async function generate(
    model,
    temperature,
    prompt,
    raw,
    json,
    client,
    streamto
) {
    return new Promise(async (resolve, reject) => {
        const body = JSON.stringify({
            model: model,
            prompt,
            options: {
                temperature: temperature,
            },
            ...(raw && { raw: true }),
            ...(json && { format: "json" })
        });
        // change color to green
        process.stdout.write("\x1b[32m" + model);
        process.stdout.write("\x1b[0m" + ": ");

        const options = {
            hostname: process.env.OLLAMA_HOST,
            port: 11434,
            path: '/api/generate',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        let forceClosed = false;
        let response = "";
        requests.map((r) => {
            try {
                r.destroy();    
            } catch (error) {                
            }            
        });
        requests.splice(0, requests.length);
        const req = http.request(options, (res) => {
            let rawData = '';
            let blankLineCount = 0;
            requests.push(req);
            res.on('data', (chunk) => {
                rawData += chunk;
                const parts = rawData.split('\n'); // Assuming newline delimiter
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] == null || parts[i].trim() == "") continue;
                    try {
                        const parsedData = JSON.parse(parts[i]);
                        if (parsedData.done) {
                        } else if (parsedData.error) {
                            forceClosed = true;
                            reject(new Error(parsedData.error));
                        } else {
                            let text = parsedData.response.toString();
                            if (text == null || text.trim() == "") {
                                blankLineCount++;
                                if (blankLineCount > 1) {
                                    var b = true;
                                }
                                if (blankLineCount > 3) {
                                    forceClosed = true;
                                    resolve(response);
                                    req.destroy();
                                    break;
                                }
                            } else {
                                blankLineCount = 0;
                            }
                            if (client != null && streamto != null && streamto != "") {
                                client.QueueMessage({ queuename: streamto, data: { func: "generating", response: text }, striptoken: true }).catch((e) => {
                                });
                            }
                            response += text
                            process.stdout.write(parsedData.response);
                        }
                    } catch (e) {
                        // console.error(e.message);
                    }
                }
                rawData = parts[parts.length - 1];
            });

            res.on('end', () => {
                if (forceClosed) return;
                console.log("");
                resolve(response);
            });
        });

        req.on('error', (e) => {
            if (forceClosed) return;
            reject(e);
        });

        // Write data to request body
        req.write(body);
        req.end();
    });
}

/**
 * 
 * @param {string} model 
 * @param {boolean} insecure 
 * @returns {Promise<void>} 
 */
async function pull(
    model,
    insecure = false,
) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            name: model,
            insecure,
            stream: true
        });
        process.stdout.write("\x1b[32mollama\x1b[0m" + ": pulling " + model);

        const options = {
            hostname: process.env.OLLAMA_HOST,
            port: 11434,
            path: '/api/pull',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        let forceClosed = false;
        requests.map((r) => {
            try {
                r.destroy();    
            } catch (error) {                
            }            
        });
        requests.splice(0, requests.length);
        const req = http.request(options, (res) => {
            requests.push(req);
            let rawData = '';
            res.on('data', (chunk) => {
                rawData += chunk;
                const parts = rawData.split('\n'); // Assuming newline delimiter
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] == null || parts[i].trim() == "") continue;
                    try {
                        const parsedData = JSON.parse(parts[i]);
                        if (parsedData.done) {
                        } else if (parsedData.error) {
                            forceClosed = true;
                            reject(parsedData.error);
                        } else {
                            let status = parsedData.status.toString();
                            let total = parsedData.total;
                            let completed = parsedData.completed;
                            console.log("\x1b[32mollama\x1b[0m" + ": pulling " + model + " " + status + " " + completed + "/" + total + " " + Math.round(completed / total * 100) + "%");
                        }
                    } catch (e) {
                        // console.error(e.message);
                    }
                }
                rawData = parts[parts.length - 1];
            });

            res.on('end', () => {
                if (forceClosed) return;
                console.log("");
                resolve();
            });
        });

        req.on('error', (e) => {
            if (forceClosed) return;
            reject(e);
        });

        // Write data to request body
        req.write(body);
        req.end();
    });
}

/**
 * 
 * @param {string} model 
 * @returns {Promise<modelinfo>} modelinfo
 */
async function show(
    model
) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify({
            name: model
        });

        const options = {
            hostname: process.env.OLLAMA_HOST,
            port: 11434,
            path: '/api/show',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(body)
            }
        };
        let forceClosed = false;
        let response = null;
        requests.map((r) => {
            try {
                r.destroy();    
            } catch (error) {                
            }            
        });
        requests.splice(0, requests.length);
        const req = http.request(options, (res) => {
            requests.push(req);
            let rawData = '';
            res.on('data', (chunk) => {
                rawData += chunk;
                const parts = rawData.split('\n'); // Assuming newline delimiter
                for (let i = 0; i < parts.length; i++) {
                    if (parts[i] == null || parts[i].trim() == "") continue;
                    try {
                        response = JSON.parse(parts[i]);
                    } catch (e) {
                        // console.error(e.message);
                    }
                }
                rawData = parts[parts.length - 1];
            });

            res.on('end', () => {
                if (forceClosed) return;
                console.log("");
                resolve(response);
            });
        });

        req.on('error', (e) => {
            if (forceClosed) return;
            reject(e);
        });

        // Write data to request body
        req.write(body);
        req.end();
    });
}
/**
 * @param {string} message 
 * @returns {chatmessage}
 */
function s(message) {
    return { role: "system", content: message };
}
/**
 * @param {string} message 
 * @returns {chatmessage}
 */
function a(message) {
    return { role: "assistant", content: message };
}
/**
 * @param {string} message 
 * @returns {chatmessage}
 */
function u(message) {
    return { role: "user", content: message };
}
/**
 * 
 * @param {string} model 
 * @param {chatmessage[]} messages 
 * @returns {Promise<string>} response
 */
async function GeneratePrompt(model, messages) {
    /**
     * @type {modelinfo|null}
     */
    let info = null;
    try {
        info = await show(model);
    } catch (error) {
        if (error.message.includes("pulling")) {
            await pull(model);
            info = await show(model);
        } else {
            throw error;
        }
    }
    let template = info.template;
    let prompt = "";
    if (template.includes("[INST]")) {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === "user" || msg.role === "system") {
                prompt += "[INST]" + msg.content + "[/INST]";
            } else {
                prompt += msg.content + "";
            }
            if (i == messages.length - 1) {
                // change color to blue
                process.stdout.write("\x1b[34m" + msg.role);
                process.stdout.write("\x1b[0m" + ": " + msg.content);
                process.stdout.write("\n");
            }
        }
    } else if (template.includes("### System") && template.includes("### User") && template.includes("### Response")) {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === "system") {
                prompt += "### System:\n" + msg.content + "\n";
            } else if (msg.role === "user") {
                prompt += "### User:\n" + msg.content + "\n";
            } else {
                prompt += "### Response:\n" + msg.content + "\n";
            }
            if (i == messages.length - 1) {
                // change color to blue
                process.stdout.write("\x1b[34m" + msg.role);
                process.stdout.write("\x1b[0m" + ": " + msg.content);
                process.stdout.write("\n");
            }
        }
        prompt += "### Response:\n";
    } else if (template == null || template == "" || template == "{{ .Prompt }}" || template.includes("tool_call") ) {
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role === "user" || msg.role === "system") {
                prompt += "<|from|>" + msg.role + "\n<|recipient|>all\n<|content|>" + msg.content + "\n";
            } else if (msg.role === "tool") {
                prompt += "<|from|>" + msg.role + "\n<|recipient|>all\n<|content|>" + msg.content + "\n";
            } else {
                prompt += "<|from|>" + msg.role + "\n<|recipient|>all\n<|content|>" + msg.content + "\n";
            }
            if (i == messages.length - 1) {
                // change color to blue
                process.stdout.write("\x1b[34m" + msg.role);
                process.stdout.write("\x1b[0m" + ": " + msg.content);
                process.stdout.write("\n");
            }
        }
        // prompt += "### Response:\n";
        
    } else {
        throw new Error("Unknown template");
    }
    return prompt;
}
/**
 * @param {chatmessage[]} messages 
 * @returns {chatmessage[]} converted messages
 */
function GenerateSummarizingMessages(messages) {
    const conversationHistory = "```\n" + JSON.stringify(messages) + "\n```"
    var result = [];
    result.push(s("You are an expert in summarizing conversations. You are helping a student summarize a conversation with an Large Language Model."));
    result.push(u("I need you to summary each message in the following chat conversation. The goal it to lower the context size. Preserve all Relevant Context, and use Contextual Referencing to avoid redundant information. "));
    result.push(a(conversationHistory));
    result.push(u(`Reply with a json object in the format \`{"message": "summary"}\`.`));
    return result;
}
/**
 * @param {chatmessage[]} messages 
 * @param {string} model 
 * @returns {Promise<chatmessage[]>} converted messages
 */
async function CompactMessages(
    messages,
    model = "llama2"
) {
    const _messages = GenerateSummarizingMessages(messages);
    do {
        process.stdout.write("\x1b[32mSUMMARIZER\x1b[0m" + ": ");
        const prompt = await GeneratePrompt(model, _messages)
        const response = await generate(model, 0.5, prompt, true, true, null, "");
        let newMessage = JSON.parse(response);
        if (newMessage != null || newMessage.trim() != "") {
            var keys = Object.keys(newMessage);
            if (keys.length != 1 || !keys.includes("message")) {
                console.log("Invalid response from LLM");
            } else {
                return [u(newMessage.message)];
            }
        }
    } while (true);
}
/**
 * @param {string} model 
 * @param {chatmessage[]} messages 
 * @param {number} temperature 
 * @returns {Promise<void>}
 */
async function SendChatMessage(
    model,
    messages,
    temperature = 0.5,
) {
    const prompt = await GeneratePrompt(model, messages)
    const response = await generate(model, temperature, prompt, true, false, null, "");
    if (messages != null) messages.push(a(response));
}

module.exports = { generate, pull, show, s, a, u, GeneratePrompt, CompactMessages, SendChatMessage };
