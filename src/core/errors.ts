/**
 * A rule violation that is safe to show to the user. Anything that is not a DomainError is
 * treated as an internal failure: logged in full, shown to the user only as a generic message.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly title = 'Action unavailable',
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export const Errors = {
  stale: () =>
    new DomainError(
      'STALE',
      'This action is no longer available.\nThe match state has changed.',
      'Action expired',
    ),
  notFound: (what: string) => new DomainError('NOT_FOUND', `${what} could not be found.`, 'Not found'),
  forbidden: () =>
    new DomainError('FORBIDDEN', 'You do not have permission to use this command.', 'Permission denied'),
};

export function isDomainError(err: unknown): err is DomainError {
  return err instanceof DomainError;
}
