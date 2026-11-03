export type StreamListener = (message: unknown) => void;

export type StreamHub = {
  subscribe(topic: string, listener: StreamListener): () => void;
  publish(topic: string, message: unknown): void;
  closeAll(): void;
};

export function endpointTopic(projectId: string, name: string): string {
  return `endpoint:${projectId}/${name}`;
}

export function sessionTopic(sessionId: string): string {
  return `session:${sessionId}`;
}

export function createStreamHub(): StreamHub {
  const topics = new Map<string, Set<StreamListener>>();

  function subscribe(topic: string, listener: StreamListener): () => void {
    let listeners = topics.get(topic);
    if (listeners === undefined) {
      listeners = new Set();
      topics.set(topic, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) topics.delete(topic);
    };
  }

  function publish(topic: string, message: unknown): void {
    const listeners = topics.get(topic);
    if (listeners === undefined) return;
    for (const listener of [...listeners]) listener(message);
  }

  function closeAll(): void {
    topics.clear();
  }

  return { subscribe, publish, closeAll };
}
