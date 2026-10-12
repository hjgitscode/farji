export type DomainErrorCode = "FORBIDDEN" | "NOT_FOUND" | "VALIDATION" | "CONFLICT";

/** Expected, user-presentable failures. Anything else is an unexpected error. */
export class DomainError extends Error {
  readonly code: DomainErrorCode;
  readonly fieldErrors: Record<string, string>;

  constructor(code: DomainErrorCode, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}
