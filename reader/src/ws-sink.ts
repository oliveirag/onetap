import { WebSocketServer, WebSocket } from "ws";
import type { Logger } from "pino";
import type { BridgeTapEvent, TapSink } from "./tap.ts";

// Broadcasts taps to the store page over ws://127.0.0.1:<port>. Message: {"type":"tap","tap":{...}}
export async function startWsSink(port: number, log: Logger): Promise<TapSink> {
  const wss = new WebSocketServer({ host: "127.0.0.1", port });

  await new Promise<void>((resolve, reject) => {
    wss.once("listening", resolve);
    wss.once("error", reject);
  });
  wss.on("error", (err) => log.error({ err: err.message }, "ws_error"));
  wss.on("connection", (socket, req) => {
    log.info({ clients: wss.clients.size, origin: req.headers.origin ?? null }, "ws_client_connected");
    socket.on("close", () => log.info({ clients: wss.clients.size }, "ws_client_disconnected"));
  });
  log.info({ url: `ws://127.0.0.1:${port}` }, "ws_listening");

  return {
    name: "websocket",
    async send(tap: BridgeTapEvent) {
      const message = JSON.stringify({ type: "tap", tap });
      let delivered = 0;
      for (const client of wss.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
          delivered++;
        }
      }
      if (delivered === 0) {
        log.warn({ tapId: tap.tapId, output: "websocket", reason: "no_clients" }, "tap_failed");
      } else {
        log.info({ tapId: tap.tapId, output: "websocket", clients: delivered }, "tap_sent");
      }
    },
    async close() {
      for (const client of wss.clients) client.close(1001, "bridge shutting down");
      await new Promise<void>((resolve) => wss.close(() => resolve()));
    },
  };
}
