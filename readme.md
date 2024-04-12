# LLM chat backend package for openiap flow llm chat page
- Create an agent, and make note of the slug name.
- Deploy this project as a package to openflow.
- Now assign this package to your agent. 
In either the agent envoriment variables, or for the package set envoriment OPENAI_API_KEY variable to you open ai key
- Once agent is running and package has successfully started, go to "Entities" -> Select mq collection -> find "llmchat" and allow "users" read on the queue.
- Go to config page, click "all" to see all settings and find `llmchat_queue` and set this to `llmchat`
- Reload browser and you should now see a `Chat` menu item, that uses the llmchat package as backend, via the `llmchat` queue
