import { z } from "zod";
import { Request, Response, NextFunction } from "express";

// At least one of email or phoneNumber must be provided
export const identifySchema = z
    .object({
        email: z.string().email("Invalid email format").optional(),
        phoneNumber: z
            .string()
            .min(1, "Phone number cannot be empty")
            .optional(),
    })
    .refine((data) => data.email !== undefined || data.phoneNumber !== undefined, {
        message: "At least one of 'email' or 'phoneNumber' must be provided",
    });

export function validateIdentify(
    req: Request,
    res: Response,
    next: NextFunction
): void {
    const result = identifySchema.safeParse(req.body);

    if (!result.success) {
        res.status(400).json({
            error: "Validation failed",
            details: result.error.errors.map((e) => ({
                field: e.path.join(".") || "body",
                message: e.message,
            })),
        });
        return;
    }

    // Replace body with the validated/parsed data
    req.body = result.data;
    next();
}
