import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { registerAllTools } from "@/lib/mcp-tools";

export async function POST(request: Request) {
  const server = new McpServer({
    name: "prince-oil-analytics",
    version: "1.0.0",
  });

  registerAllTools(server);

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — safe for serverless
  });

  await server.connect(transport);
  return transport.handleRequest(request);
}

export function GET() {
  return new Response(
    JSON.stringify({
      error: "This is an MCP server endpoint. Use a POST request with MCP JSON-RPC messages.",
      hint: "Connect via Claude Desktop or npx @modelcontextprotocol/inspector http://localhost:3000/api/mcp",
    }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } }
  );
}
