import { addEventClient } from "../services/event-bus.js";

export function eventStream(req, res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const remove = addEventClient(res);
  req.on("close", remove);
}
