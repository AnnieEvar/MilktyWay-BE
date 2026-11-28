export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export const unauthorized = () => new AppError(401, "AUTH_UNAUTHORIZED", "Authentication required.");
export const forbidden = () => new AppError(403, "AUTH_FORBIDDEN", "This action is not permitted.");
export const notFound = () => new AppError(404, "RESOURCE_NOT_FOUND", "Resource not found.");
