"""Lightweight MCP stdio client.

Spawns an MCP server as a subprocess, communicates via JSON-RPC 2.0 over stdio.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, List, Optional

from .mcp_config import McpServerConfig

logger = logging.getLogger("sidecar.mcp_client")


class McpClient:
    """Manages a single MCP server subprocess."""

    def __init__(self, config: McpServerConfig) -> None:
        self.config = config
        self._process: Optional[asyncio.subprocess.Process] = None
        self._request_id = 0
        self._tools: List[Dict[str, Any]] = []
        self._lock = asyncio.Lock()

    @property
    def server_id(self) -> str:
        return self.config.id

    @property
    def server_name(self) -> str:
        return self.config.name

    async def start(self) -> None:
        """Spawn the MCP server subprocess."""
        env = {**dict(os.environ), **self.config.env}
        self._process = await asyncio.create_subprocess_exec(
            self.config.command,
            *self.config.args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
        # Initialize the connection
        await self._send_request("initialize", {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "bitidea-desktop", "version": "0.1.0"},
        })
        # Send initialized notification
        await self._send_notification("notifications/initialized", {})
        # Discover tools
        result = await self._send_request("tools/list", {})
        self._tools = result.get("tools", []) if result else []
        logger.info(
            "MCP server '%s' started with %d tools",
            self.config.name,
            len(self._tools),
        )

    async def stop(self) -> None:
        """Terminate the subprocess."""
        if self._process and self._process.returncode is None:
            self._process.terminate()
            try:
                await asyncio.wait_for(self._process.wait(), timeout=5.0)
            except asyncio.TimeoutError:
                self._process.kill()
        self._process = None
        self._tools = []

    async def list_tools(self) -> List[Dict[str, Any]]:
        """Return cached tool definitions."""
        return self._tools

    async def call_tool(self, name: str, arguments: Dict[str, Any]) -> Any:
        """Call a tool on this server."""
        result = await self._send_request("tools/call", {
            "name": name,
            "arguments": arguments,
        })
        return result

    async def _send_request(
        self, method: str, params: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        async with self._lock:
            if not self._process or not self._process.stdin or not self._process.stdout:
                raise RuntimeError(f"MCP server '{self.config.name}' not running")
            self._request_id += 1
            msg = {
                "jsonrpc": "2.0",
                "id": self._request_id,
                "method": method,
                "params": params,
            }
            line = json.dumps(msg) + "\n"
            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()

            # Read response
            response_line = await asyncio.wait_for(
                self._process.stdout.readline(), timeout=30.0
            )
            if not response_line:
                return None
            response = json.loads(response_line.decode("utf-8"))
            if "error" in response:
                raise RuntimeError(f"MCP error: {response['error']}")
            return response.get("result")

    async def _send_notification(self, method: str, params: Dict[str, Any]) -> None:
        async with self._lock:
            if not self._process or not self._process.stdin:
                return
            msg = {
                "jsonrpc": "2.0",
                "method": method,
                "params": params,
            }
            line = json.dumps(msg) + "\n"
            self._process.stdin.write(line.encode("utf-8"))
            await self._process.stdin.drain()


class McpManager:
    """Manages multiple MCP server connections."""

    def __init__(self) -> None:
        self._clients: Dict[str, McpClient] = {}

    async def start_server(self, config: McpServerConfig) -> McpClient:
        if config.id in self._clients:
            await self.stop_server(config.id)
        client = McpClient(config)
        await client.start()
        self._clients[config.id] = client
        return client

    async def stop_server(self, server_id: str) -> None:
        client = self._clients.pop(server_id, None)
        if client:
            await client.stop()

    async def stop_all(self) -> None:
        for client in list(self._clients.values()):
            await client.stop()
        self._clients.clear()

    def get_client(self, server_id: str) -> Optional[McpClient]:
        return self._clients.get(server_id)

    def get_all_clients(self) -> List[McpClient]:
        return list(self._clients.values())

    async def get_all_tools(self) -> List[Dict[str, Any]]:
        """Collect tools from all running servers, prefixed with server name."""
        tools = []
        for client in self._clients.values():
            for tool in await client.list_tools():
                tools.append({
                    **tool,
                    "_server_id": client.server_id,
                    "_server_name": client.server_name,
                })
        return tools

    async def call_tool(
        self, server_id: str, tool_name: str, arguments: Dict[str, Any]
    ) -> Any:
        client = self._clients.get(server_id)
        if not client:
            raise RuntimeError(f"MCP server '{server_id}' not found")
        return await client.call_tool(tool_name, arguments)
