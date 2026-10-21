import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { buildServer } from "../../dist/server.js";

/** Connect an SDK client to an in-process server sharing the given state. */
export async function connectInMemory(state) {
  const server = buildServer(state);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client,
    close: async () => {
      await client.close();
      await server.close();
    },
  };
}

/** Text of the first content block of a tool result. */
export function text(result) {
  const t = result?.content?.[0]?.text;
  if (typeof t !== "string") throw new Error(`no text content in ${JSON.stringify(result)}`);
  return t;
}

export const json = (result) => JSON.parse(text(result));
