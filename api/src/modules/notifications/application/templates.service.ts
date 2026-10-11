import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import Handlebars from 'handlebars';

export interface RenderedTemplate {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

/**
 * Renders Handlebars templates from files in the repository (see
 * `../templates`), one set of three per template:
 *
 * - `<name>.subject.hbs` — the one-line subject, rendered with the same
 *   data so it can carry tenant branding;
 * - `<name>.html.hbs` — the HTML body;
 * - `<name>.txt.hbs` — the plain-text alternative (rendered without HTML
 *   escaping so characters like `&` read naturally).
 *
 * Compiled templates are cached: they are static per deployment, and a
 * template only compiles on first use.
 */
@Injectable()
export class TemplatesService {
  private readonly templatesDir = fileURLToPath(
    new URL('../templates/', import.meta.url),
  );
  private readonly cache = new Map<string, Handlebars.TemplateDelegate>();

  constructor() {
    // The shared HTML chrome (branding, footer) wraps every body via
    // `{{#> layout}}...{{/layout}}`; registered once at boot so a missing
    // layout fails loudly instead of mailing unbranded pages.
    Handlebars.registerPartial(
      'layout',
      readFileSync(join(this.templatesDir, '_layout.html.hbs'), 'utf8'),
    );
  }

  render(
    template: string,
    data: Record<string, unknown>,
  ): RenderedTemplate {
    return {
      subject: this.compile(template, 'subject', true)(data).trim(),
      html: this.compile(template, 'html', false)(data),
      text: this.compile(template, 'txt', true)(data),
    };
  }

  private compile(
    template: string,
    part: 'subject' | 'html' | 'txt',
    noEscape: boolean,
  ): Handlebars.TemplateDelegate {
    const key = `${template}.${part}`;
    const cached = this.cache.get(key);
    if (cached) {
      return cached;
    }
    // A missing file is a deployment bug, not a runtime condition: let the
    // ENOENT surface instead of mailing a half-rendered message.
    const source = readFileSync(join(this.templatesDir, `${key}.hbs`), 'utf8');
    const compiled = Handlebars.compile(source, { noEscape });
    this.cache.set(key, compiled);
    return compiled;
  }
}
