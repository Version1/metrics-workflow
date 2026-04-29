import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

export type McpTransportConfig =
  | { type: 'stdio'; command: string; args?: string[]; env?: Record<string, string> }
  | { type: 'sse'; url: string; headers?: Record<string, string> }
  | { type: 'http'; url: string; headers?: Record<string, string> };

/**
 * Wraps the MCP SDK Client with a simplified interface for tool invocation.
 * Handles transport creation, connection lifecycle, and response parsing.
 */
export class McpClientSession {
  private client: Client;
  private transportConfig: McpTransportConfig;
  private connected = false;

  constructor(transportConfig: McpTransportConfig) {
    this.transportConfig = transportConfig;
    this.client = new Client(
      { name: 'metrics-workflow', version: '1.0.0' },
      { capabilities: {} }
    );
  }

  async connect(): Promise<void> {
    const transport = this.createTransport();
    await this.client.connect(transport);
    this.connected = true;
  }

  private createTransport() {
    const cfg = this.transportConfig;
    if (cfg.type === 'stdio') {
      return new StdioClientTransport({
        command: cfg.command,
        args: cfg.args,
        env: cfg.env,
      });
    }
    if (cfg.type === 'http') {
      const url = new URL(cfg.url);
      const headers = cfg.headers ?? {};
      return new StreamableHTTPClientTransport(url, { requestInit: { headers } });
    }
    // SSE (legacy)
    const url = new URL(cfg.url);
    const requestInit: RequestInit | undefined = cfg.headers
      ? { headers: cfg.headers }
      : undefined;
    return new SSEClientTransport(url, requestInit ? { requestInit } : undefined);
  }

  /**
   * Calls an MCP tool and returns the parsed JSON result.
   * Tool results come back as `{ content: [{ type: 'text', text: '<json>' }] }`.
   */
  async callTool(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    if (!this.connected) {
      throw new Error('McpClientSession is not connected. Call connect() first.');
    }
    const result = await this.client.callTool({ name: toolName, arguments: args });

    if ('content' in result && Array.isArray(result.content)) {
      const textBlock = result.content.find(
        (block): block is { type: 'text'; text: string } => block.type === 'text'
      );
      if (textBlock) {
        try {
          return JSON.parse(textBlock.text);
        } catch {
          return textBlock.text;
        }
      }
    }

    return result;
  }

  async listTools(): Promise<string[]> {
    if (!this.connected) {
      throw new Error('McpClientSession is not connected. Call connect() first.');
    }
    const result = await this.client.listTools();
    return result.tools.map((t) => t.name);
  }

  async close(): Promise<void> {
    if (this.connected) {
      await this.client.close();
      this.connected = false;
    }
  }
}
