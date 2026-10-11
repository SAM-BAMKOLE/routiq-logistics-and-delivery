import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Parses the `If-Match` header carrying the resource version the client
 * last saw. Both the quoted ETag form (`"3"`) and the bare number (`3`) are
 * accepted; anything else is a failed precondition, never a silent pass.
 *
 * Every state-changing shipment and route action requires this header, so
 * two operators acting on the same resource cannot lose an update: the loser
 * gets 412 and reloads. A missing header is the standard 428. `resource`
 * only personalises the messages ("shipment" by default, "route" for the
 * routing endpoints).
 */
export function parseIfMatch(
  header: string | string[] | undefined,
  resource = 'shipment',
): number {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) {
    throw new HttpException(
      {
        message: `This action requires the If-Match header with the ${resource} version (see the ETag on GET).`,
        code: 'PRECONDITION_REQUIRED',
      },
      HttpStatus.PRECONDITION_REQUIRED,
    );
  }
  const cleaned = raw.trim().replace(/^"(.*)"$/, '$1');
  const version = Number(cleaned);
  if (!Number.isInteger(version) || version < 1) {
    throw new HttpException(
      {
        message: `If-Match must carry a positive integer version, got "${raw}".`,
        code: 'VERSION_INVALID',
      },
      HttpStatus.PRECONDITION_FAILED,
    );
  }
  return version;
}
