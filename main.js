// @ts-check
const { generate, pull, show, s, a, u, GeneratePrompt, CompactMessages, SendChatMessage } = require('./ollama');
const { OpenAI } = require('openai');
// import OpenAI from 'openai';

/**
 * @typedef {Array<import('openai/resources').ChatCompletionTool>} tools
 */
const mytools = [
   {
      type: "function",
      function: {
         name: "GetCollections",
         parameters: { type: "object", properties: {} }
      }
   },
   {
      type: "function",
      function: {
         name: "MongoQuery",
         description: "Run a mongodb query, and return the result.",
         parameters: {
            type: "object",
            properties: {
               query: {
                  type: "object",
                  description: "Mongodb query",
               },
               collectionname: {
                  type: "string",
                  description: "Collection to run query toward",
               },
               projection: {
                  type: "object",
                  description: "Mongodb projection",
               },
               top: {
                  type: "number",
                  description: "Number of results to return",
               }
            },
            required: ["query", "collectionname"],
         }
      }
   },
   {
      "type": "function",
      "function": {
         "name": "MongoAggregate",
         "description": "Run a mongodb Aggregate and return the result. you MUST include a pipeline in the arguments.",
         "parameters": {
            "type": "object",
            "properties": {
               "pipeline": {
                  "type": "object",
                  "description": "Mongodb Aggregate pipeline",
               },
               "collectionname": {
                  "type": "string",
                  "description": "Collection to run query toward",
               },
            },
            "required": ["pipeline", "collectionname"],
         }
      }
   },
   {
      "type": "function",
      "function": {
         "name": "RunOpenRPAWorkflow",
         "description": "Run a workflow on an OpenRPA robot",
         "parameters": {
            "type": "object",
            "properties": {
               "robotname": {
                  "type": "string",
                  "description": "Username or _id of the robot to run the workflow on",
               },
               "workflowid": {
                  "type": "string",
                  "description": "the exact name or _id of the openrpa workflow to run",
               },
               "parameters": {
                  "type": "object",
                  "description": "Arguments for workflow using syntax {\"argumentname\": \"value\"}",
               },

            },
            "required": ["robotname", "workflowid"],
         }
      }
   }




]
const { openiap } = require("@openiap/nodeapi");
/**
 * @typedef {Object} chatmessage
 * @property {"user"|"assistant"|"system"|"tool"} role - The role of the message sender
 * @property {string} content - The message content
 */

/**
 * 
 * @param {chatmessage[]} messages 
 * @returns {chatmessage[]}
 */
function clean(messages) {
   var result = [];
   messages.map((x) => {
      var obj = Object.assign({}, x);
      var keys = Object.keys(obj);
      keys.map((y) => {
         if (!["content", "name", "role", "tool_calls", "tool_call_id"].includes(y)) {
            delete obj[y];
         }
      })
      result.push(obj);
   });
   return result;
}

class openrpaqueue {
   static amqp_promises = [];
   static createPromise = () => {
     const correlationId = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
     var promise = new Promise((resolve, reject) => {
       const promise = {
         correlationId: correlationId,
         resolve: resolve, // Store the resolve function
         reject: reject, // Store the reject function
       };
       openrpaqueue.amqp_promises.push(promise);
     });
     return { correlationId, promise };
   }
   /**
    * 
    * @param {openiap} client 
    */
   static async init(client) {
       openrpaqueue.amqp_promises = [];
       openrpaqueue.queue = await client.RegisterQueue({ queuename: "" }, async (options, data, user, jwt) => {
         try {
            var promise = openrpaqueue.amqp_promises.find(x => x.correlationId == options.correlationId);
            if (promise != null) {
              if (typeof data === 'string' || (data instanceof String)) {
               // @ts-ignore
                data = JSON.parse(data);
              }
    
              if (data.command == "invokecompleted") {
               console.debug("[" + options.correlationId + "] invokecompleted");
               promise.resolve(data.data);
                openrpaqueue.amqp_promises.splice(openrpaqueue.amqp_promises.indexOf(promise), 1);
              } else if (data.command == "invokefailed") {
               console.debug("[" + options.correlationId + "] invokefailed");
                promise.reject(data.data);
                openrpaqueue.amqp_promises.splice(openrpaqueue.amqp_promises.indexOf(promise), 1);
              } else if (data.command == "timeout") {
               console.debug("[" + options.correlationId + "] timeout");
                promise.reject(new Error("Unknown queue or timeout. Either target is not valid or noone was online to answer."));
                openrpaqueue.amqp_promises.splice(openrpaqueue.amqp_promises.indexOf(promise), 1);
              } else {
               console.debug("[" + options.correlationId + "] ", data);
              }
    
            } else {
              console.warn("[" + options.correlationId + "] No promise found for correlationId: " + options.correlationId);
            }
          } catch (error) {
            console.error(error, null, { cls: "OpenAPIProxy" });
          }
       });
   }   
   static queue
}


function messageReducer(previous, item) {
   const reduce = (acc, delta) => {
      acc = { ...acc };
      for (const [key, value] of Object.entries(delta)) {
         if (acc[key] === undefined || acc[key] === null) {
            acc[key] = value;
            if (Array.isArray(acc[key])) {
               for (const arr of acc[key]) {
                  delete arr.index  // ChatCompletion's tool_calls do not contain index
               }
            }
         } else if (typeof acc[key] === 'string' && typeof value === 'string') {
            (acc[key]) += value;
         } else if (typeof acc[key] === 'number' && typeof value === 'number') {
            (acc[key]) = value;
         } else if (Array.isArray(acc[key]) && Array.isArray(value)) {
            const accArray = acc[key];
            for (let i = 0; i < value.length; i++) {
               const { index, ...chunkTool } = value[i];
               if (index - accArray.length > 1) {
                  throw new Error("array contains empty")
               }
               accArray[index] = reduce(accArray[index], chunkTool);
            }
         } else if (typeof acc[key] === 'object' && typeof value === 'object') {
            acc[key] = reduce(acc[key], value);
         }
      }
      return acc;
   };

   return reduce(previous, item.choices[0].delta)
}


async function chatollama(client, user, jwt, replyto, model, thread, messages, temperature) {
   // let functions = `You are a helpful assistent, that only comunicates using JSON.
   // The expected output from you has to be: 
   //     {
   //         "function": {function_name},
   //         "args": [],
   //         "content": {explanation}
   //     }
   // Here are the functions available to you:
   //     function_name=GetCollections, 
   //     args=[]
   //     ai_notes=Returns a list of mongodb collections available to the user.

   //     function_name=Query,
   //     args=[{collectionname, query}]
   //     ai_notes=Run a mongodb query, and return the result.

   // When you receive a response from a function decide if you want to respond to the user or not.
   // If you want to respond to the user, then you have to send a message to the user with the response.
   // {
   //    "function": "response",
   //    "args": [],
   //    "content": {your response}
   // }
   // `;
   let systemmessage ={"role": "user", "content": `The expected output from you has to be: 
{
   "function": {function_name},
   "args": {"arg1": "value1", "arg2": "value2"},
   "content": {explanation}
}
Here are the functions available to you:
${mytools.map((x) => {
return `function_name=${x.function.name}, 
args={${Object.keys(x.function.parameters.properties).map((y) => {
return `{"${y}": ${x.function.parameters.properties[y].type}}`
}).join(", ")}}
description=${x.function.description}
`
}).join("\n")}
}
When you receive a response from a function decide if you want to respond to the user or not.
If you want to respond to the user, then you have to send a message to the user with the response.
{
"function": "response",
"args": {},
"content": {your response}
}
`};
   let toolResponse = false;
   let response = "";
   if(temperature == null) temperature = 0.1;
   // let functions = { role: 'system', content: functions }
   do {
      toolResponse = false;
      let prompt = await GeneratePrompt(model, [systemmessage, ...messages]);
      // messages[messages.length - 1].tool_calls = mytools;
      // let prompt = await GeneratePrompt(model, messages);
      response = await generate(model, temperature, prompt, true, true, client, replyto);
      let objresponse = JSON.parse(response);
      if (objresponse.function != null && objresponse.function != "" && objresponse.function != "response") {
         toolResponse = true;
         var funcname = objresponse.function;
         var args2 = objresponse.args;
         if (funcname == "GetCollections") {
            var collections = await client.ListCollections({jwt});
            var res = collections.map((x) => x.name);
            await AddMessage(client, user, thread, messages, replyto, {
               role: "user",
               name: objresponse.function,
               content: "Result from calling `" + objresponse.function + "` was: " + JSON.stringify(res),
            });

         } else if (funcname == "MongoAggregate") {
            let [collectionname, pipeline] = args2;
            if (pipeline == null) pipeline = [];
            var results = await client.Aggregate({ jwt, collectionname, aggregates: pipeline });
            results.map((x) => {
               var keys = Object.keys(x);
               keys.map((y) => {
                  if (y.startsWith("_") && y != "_id") {
                     delete x[y];
                  }
               })
            });
            var res = results;
            await AddMessage(client, user, thread, messages, replyto, {
               role: "user",
               name: objresponse.function,
               content: "Result from calling `" + objresponse.function + "` was: " + JSON.stringify(res),
            });

         } else if (funcname == "MongoQuery") {
            // query: {
            //    type: "object",
            //    description: "Mongodb query",
            // },
            // collectionname: {
            //    type: "string",
            //    description: "Collection to run query toward",
            // },
            // projection: {
            //    type: "object",
            //    description: "Mongodb projection",
            // },
            // top: {
            //    type: "number",
            //    description: "Number of results to return",
            // }

            let [query, collectionname, projection, top] = [null, null, null, 5];
            if(args2.length > 0) {
               query = args2[0];
            }
            if(args2.length > 1) {
               collectionname = args2[1];
            }
            if(args2.length > 2) {
               projection = args2[2];
            }
            if(args2.length > 3) {
               top = parseInt(args2[3]);
            }
            // @ts-ignore
            if (query == null) query = {};
            var results = await client.Query({ jwt, collectionname, projection, query, top: 5 });
            results.map((x) => {
               var keys = Object.keys(x);
               keys.map((y) => {
                  if (y.startsWith("_") && y != "_id") {
                     delete x[y];
                  }
               })
            });
            var res = results;
            await AddMessage(client, user, thread, messages, replyto, {
               role: "user",
               name: objresponse.function,
               content: "Result from calling `" + objresponse.function + "` was: " + JSON.stringify(res),
            });

         } else {
            await AddMessage(client, user, thread, messages, replyto, {
               role: "user",
               error: true,
               name: objresponse.function,
               content: "Function `" + objresponse.function + "` not found",
            });
         }
         // var _response = {
         //    role: "assistant",
         //    content: `The result of GetCollections is: ${JSON.stringify(ai_response)}`,
         // }
         // await AddMessage(client, user, thread, messages, replyto, _response);
      }
   } while (toolResponse == true);
   try {
      var responseobj = JSON.parse(response);
      if (responseobj.content != null && responseobj.content != "") {
         await AddMessage(client, user, thread, messages, replyto, { role: "assistant", "content": responseobj.content });
      } else {
         await AddMessage(client, user, thread, messages, replyto, { role: "assistant", "content": response });
      }
   } catch (error) {
      await AddMessage(client, user, thread, messages, replyto, { role: "assistant", "content": response });
   }
   var name = messages[messages.length - 1].content;
   if (name.length > 40) {
      name = name.substring(0, 40);
   }
}
var collections = [];
/**
 * @param {openiap} client
 * @param {string} replyto
 * @param {string} model
 * @param {any} thread
 * @param {chatmessage[]} messages
 * @param {number} temperature
 */
async function chatopenai(client, user, jwt, replyto, model, thread, messages, temperature) {

   var apiKey = process.env["OPENAI_API_KEY"];
   if(user != null && user.customerid != null && user.customerid != "") {
      const customer = await client.FindOne({ collectionname: "users", query: { _id: user.customerid } });
      if(customer != null) {
         // @ts-ignore
         var openaikey = customer.openaikey;
         if(openaikey != null && openaikey != "") {
            apiKey = openaikey;
         }
      }
   }
   if(apiKey == null || apiKey == "") {
      throw new Error("No openaikey set on customer object, and default OPENAI API KEY was not set");
   }
   const openai = new OpenAI({apiKey});
   let toolResponse = false;
   let response = "";
   do {
         if(collections == null || collections.length == 0) {
            collections = await client.ListCollections({ jwt });
         }
      const systemmessage = {
         "role": "user",
         "content": `## Overall Goal
       Your functions have full access to the openflow platform. Your task is to identify the appropriate functions to call to find the information I ask for.
       
       ## **IMPORTANT INSTRUCTION**: 
       - When calling the \`MongoAggregate\` function, you **MUST** include a detailed pipeline in the arguments.
       - When using the \`MongoQuery\` function, ensure to specify a detailed query that filters the documents based on the request.
       
       ## Object Schema Details
       The user has access to the following collections: [${collections.map(x => x.name).join(", ")}].
       All collections contain multiple objects, each object has a \`_type\` property, that specifies the type of object.
       For instance, 
       - config contain objects realted to configuration og OpenFlow with \`_type\` = \`config\`, \`oauthclient\`, \`provider\`, \`resource\`, \`resourceusage\`.
       - users contain objects related to identities in OpenFlow with \`_type\` = \`user\`, \`role\`, \`customer\`.
       - openrpa contain objects related to OpenRPA robots with \`_type\` = \`workflow\`, \`project\`, \`detector\`, \`credential\`.
       - openrpa_instances contain an object for every time a workflow was run on an OpenRPA robot with \`_type\` = \`workflowinstance\`.
       \`name\` is the workflow name, \`WorkflowId\` is the _id of the workflow from \`openrpa\` collection, \`projectname\` is the openrpa project name, \`projectid\` is the _id of the project from \`openrpa\` collection, \`robotid\` is the _id of the robot from \`openrpa\` collection.
       \`owner\` is the username of the robot that ran it \`ownerid\` is the _id of the robot found in \`users\` collection with _type: user
       \`owner\` and \`fqdn\` is the hostname of the robot that ran it. \`isCompleted\` and \`hasError\` are booleans \`state\` is the state of the workflow instance.
       \`errormessage\` if failed, this is the error message.
       - agents contain objects related to agents (a type of serverless function) with \`_type\` = \`agent\`, \`package\`.
       - audit contain objects related to login and actions performed in OpenFlow with \`_type\` = \`license\`, \`impersonate\`, \`signin\`, \`nodered\`.

       All objects in these collections have some common properties: \`name\`, \`_type\`, \`_created\` (Date), \`_createdby\` (username), \`_createdbyid\` (_id of user)
       , \`_modified\` (Date), \`_modifiedby\` (username), \`_modifiedbyid\` (_id of user)..

       
       ## Specific Instructions for Queries and Pipelines
       - For \`MongoQuery\`, construct a query that precisely targets the needed information. For example, if looking for a user named 'macuser', the query should be something like: \`{ "name": "macuser" }\`.
       - For \`MongoAggregate\`, build a pipeline that will effectively aggregate the data to extract the required information. For example, if aggregating user data, the pipeline might include stages like match, group, and project.
       - When searching for a user, searchs on both \`name\` and \`username\` field, try exact searc
       {"$or": [{"name": { "$regex": "^searchstring$", "$options": "i"} }, {"username": { "$regex": "^searchstring$", "$options": "i"} }]}
       if none or more than one found, try partial search
       {"$or": [{"name": { "$regex": "searchstring", "$options": "i"} }, {"username": { "$regex": "searchstring", "$options": "i"} }]}

       ## Example Function Calls
       Here is an example of how the \`MongoQuery\` function call should look:
       {
          "type": "function",
          "function": {
             "name": "MongoQuery",
             "arguments": {
                "collectionname": "users",
                "query": { "name": {$regex: "allan", $options: "i"} }
             }
          }
       }
       Here is an example of how the \`MongoAggregate\` function call should look:
       {
         "type": "function",
         "function": {
           "name": "MongoAggregate",
           "arguments": {
             "collectionname": "pipedrive",
             "pipeline": [
               {
                 "$group": {
                   "_id": "$_type",
                   "totalCount": { "$sum": 1 }
                 }
               }
             ]
           }
         }
       }

      ## run/execute
      If I ask you to run or execute a workflow, we will assume I mean an OpenRPA workflow.
      
      1. First find the user that owns the robot. You find the user in the \`users\` collection.
      {"$or": [{"name": { "$regex": "^robotname$", "$options": "i"} }, {"username": { "$regex": "^robotname$", "$options": "i"} }], "_type": "user"}
      2. Next you need to find the workflow i want you to run, simply do an case insensetive serch on name in \`openrpa\` collection with _type: workflow.
      {"$or": {"name": { "$regex": "^workflowname$", "$options": "i"} }, "_type": "workflow"}
      3. IMPORTANT!. Now inspect the Parameters property on the workflow to see if it requires any arguments. If it does, you need to ask me for the arguments.
      4. Then you should call the \`RunOpenRPAWorkflow\` function with the robotname, workflowid and parameters.
      5. Confirm if workflow execution was successfull by inspecting the reply, and let the user know the result(s) of the workflow
         
       ## Error Handling
       - If you encounter an error, analyze the error message, adjust your query or pipeline accordingly, and retry.
       - Persistence is key. Keep trying with different approaches until you find a solution to the request.
       
       Remember, the accuracy and specificity of the function calls are crucial for successful information retrieval.`
       }
       
       


         toolResponse = false;
      // @ts-ignore
      const chatCompletion = await openai.chat.completions.create({
         messages: [systemmessage, ...clean(messages)],
         tool_choice: 'auto',
         tools: mytools,
         model,
         // response_format: { type: 'json_object' },
         stream: true
      });
      response = "";
      let responseMessage = null;
      for await (const chunk of chatCompletion) {
         let chunktext = chunk.choices[0]?.delta?.content || '';
         responseMessage = messageReducer(responseMessage, chunk);
         if (chunk.choices[0].finish_reason == null) {
            if (chunktext != null && chunktext != "") {
               process.stdout.write(chunktext);
               client.QueueMessage({ queuename: replyto, data: { func: "generating", threadid: thread._id, response: chunktext }, striptoken: true }).catch((e) => { });
            }
            continue;
         }

         var tool_calls = responseMessage?.tool_calls || null;
         if (tool_calls != null) {
            toolResponse = true;
            await AddMessage(client, user, thread, messages, replyto, { ...responseMessage, role: "assistant" });
            
            for (var i = 0; i < tool_calls.length; i++) {
               var toolCall = tool_calls[i];
               // @ts-ignore
               let arguments = toolCall.function.arguments;
               try {
                  if(typeof arguments == "string") {
                     arguments = JSON.parse(arguments);
                  }
               } catch (error) {

               }
               if (toolCall.function?.name == "GetCollections") {
                  console.log("GetCollections")
                  collections = await client.ListCollections({ jwt });
                  var res = collections.map((x) => x.name);

                  await AddMessage(client, user, thread, messages, replyto, {
                     role: "tool",
                     tool_call_id: toolCall.id,
                     name: toolCall.function.name,
                     content: JSON.stringify(res),
                  });
               } else if (toolCall.function?.name == "MongoAggregate") {

                  var pipeline = undefined;
                  if (arguments.pipeline != null) pipeline = arguments.pipeline;
                  var collectionname = arguments.collectionname;
                  console.log("MongoAggregate", collectionname, pipeline)
                  try {
                     if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
                     if (pipeline == null) throw new Error("pipeline is mandatory. You MUST send a pipeline when calling 'MongoAggregate'");
                     var results = await client.Aggregate({ jwt, collectionname, aggregates: pipeline, queryas: user._id  });
                     results.map((x) => {
                        var keys = Object.keys(x);
                        keys.map((y) => {
                           if (y.startsWith("_") && y != "_id") {
                              delete x[y];
                           }
                        })
                     });
                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: JSON.stringify(results),

                        collectionname, pipeline
                     });
                  } catch (error) {
                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`,
                        collectionname, pipeline
                     });
                  }
               } else if (toolCall.function?.name == "MongoQuery") {
                  var projection = undefined;
                  var top = 5;
                  if (arguments.top != null) top = parseInt(arguments.top);
                  if (arguments.projection != null) arguments.projection;
                  var query = arguments.query;
                  if (query == null || query == "") query = {};
                  try {
                     var collectionname = arguments.collectionname;
                     if (collectionname == null || collectionname == "") throw new Error("collectionname is mandatory");
                     var results = await client.Query({ jwt, collectionname, query, top, projection, queryas: user._id });
                     results.map((x) => {
                        delete x["Xaml"];
                     });
                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: JSON.stringify(results),

                        collectionname, query, top, projection
                     });
                  } catch (error) {
                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`,

                        collectionname, query, top, projection
                     });
                  }
               } else if (toolCall.function?.name == "RunOpenRPAWorkflow") {
                  console.log("RunOpenRPAWorkflow")
                  var robotname = "";
                  var workflowid = "";
                  var parameters = {};
                  let robotid = "";
                  if (arguments.robotname != null) robotname = arguments.robotname;
                  if (arguments.workflowid != null) workflowid = arguments.workflowid;
                  if (arguments.parameters != null) parameters = arguments.parameters;
                  try {
                     var robotuser = null;
                     if(robotname != null && robotname != "") {
                         robotuser = await client.FindOne({
                           jwt, queryas: user._id, collectionname: "users", query: {
                             "_type": "user",
                             "$or": [{ "_id": robotname },
                              { "name": { "$regex": "^" + robotname + "$", "$options": "i" } },
                             { "username": { "$regex": "^" + robotname + "$", "$options": "i" } }]
                           } 
                         });
                     }
                     if(robotuser == null) throw new Error("Robot " + robotname + " not found");
                     robotid = robotuser._id;
                     var workflow = null;
                     if(workflowid != null && workflowid != "") {
                         workflow = await client.FindOne({
                           jwt, queryas: user._id, collectionname: "openrpa", query: {
                             "_type": "workflow",
                             "$or": [{ "_id": workflowid },
                             { "name": { "$regex": "^" + workflowid + "$", "$options": "i" } },
                             { "projectandname": { "$regex": "^" + workflowid + "$", "$options": "i" } }]
                           }
                         });
                     }
                     if(workflow == null) throw new Error("Workflow " + workflowid + " not found");
                     const rpacommand = {
                       command: "invoke",
                       workflowid: workflow._id,
                       data: parameters
                     }
                     console.log("run workflow " + workflow._id + " on robot " + robotid);
                     let result = {"status": "No response"};
                     const { correlationId, promise } = openrpaqueue.createPromise();
                     console.debug("[" + correlationId + "] " + JSON.stringify(rpacommand));
                     client.QueueMessage({ jwt, queuename: robotid, correlationId, data: rpacommand, replyto: openrpaqueue.queue, striptoken: true }, false);
                     var _res = await promise;
                     if(_res != null) {
                        result = await _res;
                     }
                     // result = {"status": "Sent", correlationId};

                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: JSON.stringify(result),
                        robotid, workflowid, parameters, correlationId
                     });
                  } catch (error) {
                     console.error(error.message ? error.message : error);
                     await AddMessage(client, user, thread, messages, replyto, {
                        role: "tool",
                        tool_call_id: toolCall.id,
                        name: toolCall.function.name,
                        content: `Error: ${error.message}`,

                        robotid, workflowid, parameters
                     });
                  }

               } else {
                  await AddMessage(client, user, thread, messages, replyto, {
                     role: "tool",
                     tool_call_id: toolCall.id,
                     name: toolCall.function.name,
                     content: "Function not found"
                  });
               }
            }
         } else {
            await AddMessage(client, user, thread, messages, replyto, { role: "assistant", content: responseMessage.content });
         }
      }
   } while (toolResponse == true);

   var name = messages[messages.length - 1].content;
   if (name.length > 40) {
      name = name.substring(0, 40);
   }
}
async function chat(client, user, jwt, replyto, model, thread, messages, temperature) {
   var useollama = false;
   var useopenai = false;
   if (model.startsWith("ollama/")) {
      model = model.substring(7);
      useollama = true;
   } else if (model.startsWith("openai/")) {
      model = model.substring(7);
      useopenai = true;
   } else {
      if (model == "") {
         useopenai = true
         model = "gpt-3.5-turbo-1106";
      }
   }
   if (useollama) {
      if(process.env.OLLAMA_HOST == null || process.env.OLLAMA_HOST == "") {
         throw new Error("No OLLAMA_HOST set");
      }
      return await chatollama(client, user, jwt, replyto, model, thread, messages, temperature);
   } else if(useopenai)  {
      return await chatopenai(client, user, jwt, replyto, model, thread, messages, temperature);
   } else {
      throw new Error("Model " + model + " not found");
   }
}

async function AddMessage(client, user, thread, messages, replyto, message) {
   var name = message.role + ": " + message.content?.substring(0, 40);
   if(message.tool_calls != null) {
      name += " " + message.tool_calls[0]?.function?.name;
   }
   message.index = messages.length;
   client.InsertOne({ collectionname: "llmchat", item: { 
      _acl: [{"_id": user._id, "name": user.name , "rights": 2}, {"_id": "5a1702fa245d9013697656fb", "name": "admins", "rights": 65535}],
      threadid: thread._id, _type: "message", name, message } }).catch((e) => { });
   messages.push(message);
   if(replyto != null && replyto != "") {
      client.QueueMessage({ queuename: replyto, data: { func: "message", threadid: thread._id, message }, striptoken: true }).catch((e) => { });
   }
}
async function GetMessages(client, threadid) {
   const _messages = await client.Query({ collectionname: "llmchat", query: { threadid, _type: "message" }});
   _messages.sort((a, b) => {
      return a.message.index - b.message.index;
   });
   const messages = _messages.map((x) => x.message);
   if(messages.length > 5) {
      var b = true;
   }
   return messages;
}
async function GetThread(client, jwt, threadid, user, message) {
   if(threadid == "" || threadid == null) {
      var username = user?.username;
      if(username == null) username = "";
      threadid = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
      var name = username + " " + message.substring(0, 40);
      const thread = await client.InsertOne({ collectionname: "llmchat", item: { 
         _acl: [{"_id": user._id, "name": user.name , "rights": 2}, {"_id": "5a1702fa245d9013697656fb", "name": "admins", "rights": 65535}],
         _id: threadid, _type: "thread", user, name } });
      return { thread, messages: [] };
   } else {
      const thread = await client.Query({ jwt, collectionname: "llmchat", query: { _id: threadid, _type: "thread" } });
      if(thread.length == 0) {
         throw new Error("Thread " + threadid + " not found");
      }
      return { thread: thread[0], messages: await GetMessages(client, threadid) };
   }   
}

/** 
 * @param {openiap} client
 * **/
async function onConnected(client) {
   console.log("connected");
   await openrpaqueue.init(client);
   var localqueue = await client.RegisterQueue({ queuename: "llmchat" }, async (msg, payload, user, jwt) => {
      const func = payload.func;
      if(jwt == null || jwt == "") {
         return { func, error: "Missing token" }
      }
      const message = payload.message;
      const model = payload.model;
      const replyto = msg.replyto;
      
      try {
         const { thread, messages } = await GetThread(client, jwt, payload.threadid, user, message);
         await AddMessage(client, user, thread, messages, replyto, u(message));
         switch (func) {
            case "chat":
               try {
                  var result = await chat(client, user, jwt, replyto, model, thread, messages);
                  return { func, threadid: thread._id }
               } catch (error) {
                  await AddMessage(client, user, thread, messages, replyto, { role: "assistant", "error": true, content: error.message });
                  console.error(error.message);
                  return { func, error: error.message, threadid: thread._id }
               }
               break;
            case "generate":
               var useOpenAI = process.env["OPENAI_API_KEY"] != null && process.env["OPENAI_API_KEY"] != "";
               useOpenAI = false;
               if (useOpenAI) {
                  const openai = new OpenAI({});  // apiKey: ''

                  const chatCompletion = await openai.chat.completions.create({
                     messages: [{ role: 'user', content: payload.prompt }],
                     model: 'gpt-3.5-turbo-1106',
                     response_format: { type: 'json_object' },
                     stream: true
                  });
                  var response = "";
                  for await (const chunk of chatCompletion) {
                     var text = chunk.choices[0]?.delta?.content || '';
                     response += text;
                     process.stdout.write(text);
                     client.QueueMessage({ queuename: replyto, data: { func: "generating", threadid: thread._id, response: text }, striptoken: true }).catch((e) => {
                     });
                  }
                  // var res = chatCompletion.choices[0];
                  // return {func, response: res.message.content};
                  var name = payload.prompt;
                  if (name.length > 40) {
                     name = name.substring(0, 40);
                  }
                  return { func, response, threadid: thread._id };
               } else {
                  let response = await generate(payload.model, payload.temperature, payload.prompt, payload.raw, payload.json, client, replyto);
                  var name = payload.prompt;
                  if (name.length > 40) {
                     name = name.substring(0, 40);
                  }
                  client.InsertOne({ collectionname: "llmchat", item: { 
                     _acl: [{"_id": user._id, "name": user.name , "rights": 2}, {"_id": "5a1702fa245d9013697656fb", "name": "admins", "rights": 65535}],
                     name, prompt: payload.prompt, response: response } }).catch((e) => { });
                  return { func, response, threadid: thread._id };
               }
            case "pull":
               await pull(payload.model);
               let modelinfo1 = await show(payload.model);
               return { func, modelinfo: modelinfo1, threadid: thread._id };
            case "show":
               let modelinfo2 = await show(payload.model);
               return { func, modelinfo: modelinfo2, threadid: thread._id };
            case "GeneratePrompt":
               let prompt = await GeneratePrompt(payload.model, payload.message);
               return { func, prompt, threadid: thread._id };
            default:
               return { func, error: "Invalid function name", threadid: thread._id }
         }
      } catch (error) {
         return { func, error: error.message }
      }
   })
   console.log("listening on " + localqueue);
}
async function main() {
   var client = new openiap();
   client.onConnected = onConnected
   await client.connect();
}
main();