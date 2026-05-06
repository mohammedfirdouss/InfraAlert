"""Entry point for the InfraAlert MCP Server."""

from server import mcp

if __name__ == "__main__":
    mcp.run(transport="streamable-http", host="0.0.0.0", port=8080)
