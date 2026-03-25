// server.js — Claude API Proxy for Roblox Plugin
// Run with: node server.js
// Deploy to: Railway, Render, Fly.io, or any Node host

const http = require("http");
const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY; // Set this env var!
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // CORS headers so Roblox can reach us
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method !== "POST" || req.url !== "/generate") {
    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
    return;
  }

  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const { prompt } = parsed;
    if (!prompt) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: "Missing prompt" }));
      return;
    }

    // Build the Claude API request
    const payload = JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: `You are a Roblox game development assistant. 
When asked to generate game elements, respond ONLY with valid Lua code that can be executed in Roblox Studio.
The code should use Roblox's API (Instance.new, workspace, game.Players, etc.).
Do not include any explanation text — just the Lua code block.
Always wrap output in a function called GenerateContent() that returns the created instances.`,
      messages: [{ role: "user", content: prompt }],
    });

    const options = {
      hostname: "api.anthropic.com",
      path: "/v1/messages",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const apiReq = https.request(options, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => (data += chunk));
      apiRes.on("end", () => {
        try {
          const result = JSON.parse(data);
          const text = result.content?.[0]?.text || "";
          // Strip markdown code fences if present
          const lua = text.replace(/```lua\n?|```\n?/g, "").trim();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ lua }));
        } catch {
          res.writeHead(500);
          res.end(JSON.stringify({ error: "Failed to parse Claude response" }));
        }
      });
    });

    apiReq.on("error", (err) => {
      res.writeHead(500);
      res.end(JSON.stringify({ error: err.message }));
    });

    apiReq.write(payload);
    apiReq.end();
  });
});

server.listen(PORT, () => {
  console.log(`✅ Claude proxy running on port ${PORT}`);
});
