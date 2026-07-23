import { Router } from "express";
import * as githubController from "../controllers/github.controller";

const router = Router();

router.post("/github", githubController.handleWebhook);

export default router;
