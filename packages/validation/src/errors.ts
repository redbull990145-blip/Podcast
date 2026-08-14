/**
 * Turns a Zod failure into the flat `{ field: message }` map the API error
 * envelope carries, and that forms can render directly next to inputs.
 *
 * Zod's own tree is richer than a form needs; flattening here means neither
 * client has to walk it, and both show the same message for the same mistake.
 */

import type { ZodError } from 'zod';

export function formatFieldErrors(error: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};

  for (const issue of error.issues) {
    // Dotted path so nested inputs (`profile.locale`) address a form field.
    const path = issue.path.map(String).join('.') || '_';
    // First message per field wins: a field showing three complaints at once
    // reads as noise, and the first is the one the user hits first.
    fields[path] ??= issue.message;
  }

  return fields;
}
