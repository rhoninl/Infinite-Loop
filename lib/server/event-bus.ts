import type { RunEvent } from '../shared/types';

type Subscriber = (event: RunEvent) => void;

class EventBus {
  private subscribers = new Set<Subscriber>();

  subscribe(handler: Subscriber): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  emit(event: RunEvent): void {
    for (const sub of this.subscribers) {
      try {
        sub(event);
      } catch (err) {
        console.error('event-bus subscriber threw', err);
      }
    }
  }

  clear(): void {
    this.subscribers.clear();
  }
}

export const eventBus = new EventBus();
