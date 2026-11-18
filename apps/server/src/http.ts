export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'HttpError';
  }
}

export function asHttp(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof Error) {
    const status = error.message.startsWith('No existe') ? 404 : 400;
    throw new HttpError(status, error.message);
  }
  throw error;
}
