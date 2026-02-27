import { Router } from "express";
import { identifyController } from "../controllers/identify.controller";
import { validateIdentify } from "../middleware/validate";

const router = Router();

/**
 * POST /identify
 * Reconcile customer identity based on shared email or phoneNumber.
 */
router.post("/identify", validateIdentify, identifyController);

export default router;
