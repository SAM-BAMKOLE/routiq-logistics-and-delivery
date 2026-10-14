/** Tiny dependency-free logger with per-actor colours, so a multi-bot run stays readable. */

const RESET = '\u001b[0m';
const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';

const COLOURS = {
  cyan: '\u001b[36m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  magenta: '\u001b[35m',
  blue: '\u001b[34m',
  red: '\u001b[31m',
  gray: '\u001b[90m',
} as const;

export type Colour = keyof typeof COLOURS;

function timestamp(): string {
  return new Date().toISOString().slice(11, 19);
}

export class Logger {
  constructor(
    private readonly actor: string,
    private readonly colour: Colour = 'gray',
  ) {}

  private write(icon: string, message: string, extra?: string): void {
    const prefix = `${DIM}${timestamp()}${RESET} ${COLOURS[this.colour]}${BOLD}${icon} ${this.actor}${RESET}`;
    console.log(`${prefix} ${message}${extra ? ` ${DIM}${extra}${RESET}` : ''}`);
  }

  info(message: string, extra?: string): void {
    this.write('•', message, extra);
  }

  step(message: string, extra?: string): void {
    this.write('→', message, extra);
  }

  ok(message: string, extra?: string): void {
    this.write('✓', message, extra);
  }

  warn(message: string, extra?: string): void {
    this.write('!', `${COLOURS.yellow}${message}`, extra);
  }

  error(message: string, extra?: string): void {
    this.write('✗', `${COLOURS.red}${message}`, extra);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function money(minor: number, currency = 'NGN'): string {
  const symbol = currency === 'NGN' ? '₦' : currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${(minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
