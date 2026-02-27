import { Request, Response, NextFunction } from "express";
import { identifyContact } from "../services/identify.service";
import { IdentifyRequest } from "../types";

export async function identifyController(
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> {
    try {
        const payload: IdentifyRequest = req.body;

        console.log(
            `[POST /identify] email=${payload.email ?? "null"} phoneNumber=${payload.phoneNumber ?? "null"}`
        );

        const result = await identifyContact(payload);

        res.status(200).json(result);
    } catch (error) {
        next(error);
    }
}
