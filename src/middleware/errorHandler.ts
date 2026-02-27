import { Request, Response, NextFunction } from "express";

export interface AppError extends Error {
    statusCode?: number;
}

// Global Express error handler
export function errorHandler(
    err: AppError,
    _req: Request,
    res: Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: NextFunction
): void {
    const status = err.statusCode ?? 500;
    const message =
        process.env.NODE_ENV === "production" && status === 500
            ? "Internal server error"
            : err.message ?? "Internal server error";

    console.error(`[Error] ${status} - ${err.message}`);
    if (status === 500) console.error(err.stack);

    res.status(status).json({ error: message });
}

// Convenience factory for typed application errors
export function createError(message: string, statusCode: number): AppError {
    const err = new Error(message) as AppError;
    err.statusCode = statusCode;
    return err;
}
