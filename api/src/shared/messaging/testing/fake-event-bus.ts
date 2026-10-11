import type { EventBus } from '../event-bus.js';
import type { DomainEventEnvelope } from '../event-envelope.js';

/**
 * Recording {@link EventBus} for specs: captures published envelopes so a
 * test can assert on event types, payloads, and ordering without a
 * transport. Lives next to the port so every module's harness shares it.
 */
export class FakeEventBus implements EventBus {
  readonly published: DomainEventEnvelope[] = [];

  async publish(event: DomainEventEnvelope): Promise<void> {
    this.published.push(event);
  }

  async publishAll(events: readonly DomainEventEnvelope[]): Promise<void> {
    this.published.push(...events);
  }

  /** Published envelope types, in order of publication. */
  types(): string[] {
    return this.published.map((event) => event.type);
  }

  /** The most recent envelope of a type, or undefined. */
  lastOfType(type: string): DomainEventEnvelope | undefined {
    return [...this.published].reverse().find((event) => event.type === type);
  }

  clear(): void {
    this.published.length = 0;
  }
}
