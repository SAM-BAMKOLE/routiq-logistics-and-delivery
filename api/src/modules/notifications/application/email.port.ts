/** DI token for the {@link EmailPort} outbound port. */
export const EMAIL_PORT = Symbol('EMAIL_PORT');

/**
 * One rendered email, ready to hand to a transport. Both parts are always
 * present: the plain-text body helps deliverability from a personal Gmail
 * sender, and clients render the HTML.
 */
export interface EmailMessage {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  /**
   * Display name for the sender. Gmail rewrites the address to the
   * authenticated account, so this is how the tenant's name reaches the
   * "From" line; adapters compose it with their own credentials.
   */
  readonly fromName?: string;
  /** Tenant contact address, so replies go to the tenant and not to Gmail. */
  readonly replyTo?: string;
}

/**
 * Outbound port for sending email, per the architecture's ports-and-adapters
 * rule: the Notifications application layer renders and records, transports
 * stay swappable (Gmail SMTP in staging, console locally, memory in tests).
 */
export interface EmailPort {
  send(message: EmailMessage): Promise<void>;
}
