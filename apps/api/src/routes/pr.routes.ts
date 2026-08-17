import { Router } from "express";
import { getPullRequests } from "../controllers/pr.controller";

const router = Router();

router.get("/", getPullRequests);

export default router;