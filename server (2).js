// server.js — Fixed version
const http = require("http");
const https = require("https");

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  console.log(`${req.method} ${req.url}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check — visit your URL in browser to confirm it works
  if (req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", message: "Claude proxy is running!" }));
    return;
  }

  // Accept POST to ANY path (fixes Railway path issues)
  if (req.method === "POST") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let parsed;
      try {
        parsed = JSON.parse(body);
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
        return;
      }

      const { prompt } = parsed;
      if (!prompt) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Missing prompt field" }));
        return;
      }

      if (!ANTHROPIC_API_KEY) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "ANTHROPIC_API_KEY not set on server" }));
        return;
      }

      const payload = JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        system: `You are a Roblox game development assistant.
When asked to generate game elements, respond ONLY with valid Lua code for Roblox Studio.
Use Roblox API: Instance.new, workspace, game.Players, etc.
Do not include explanation — just the Lua code.
Always wrap output in a function called GenerateContent() that creates and parents instances to workspace.`,
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
            const lua = text.replace(/```lua\n?|```\n?/g, "").trim();
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ lua }));
          } catch (e) {
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Failed to parse Claude response: " + e.message }));
          }
        });
      });

      apiReq.on("error", (err) => {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "API request failed: " + err.message }));
      });

      apiReq.write(payload);
      apiReq.end();
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, () => {
  console.log(`Claude proxy running on port ${PORT}`);
});
