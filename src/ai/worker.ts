/// <reference lib="webworker" />
import { decide, type BotInput } from './decide';

// Runs bot decisions off the main thread so animations stay smooth.
self.onmessage = (e: MessageEvent<{ id: number; input: BotInput }>) => {
  const { id, input } = e.data;
  try {
    const d = decide(input);
    (self as unknown as Worker).postMessage({ id, action: d.action, equity: d.equity });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: String(err) });
  }
};
