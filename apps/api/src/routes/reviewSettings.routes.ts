import { Router } from "express";
import {
  getReviewSettings,
  resetReviewSettings,
  saveReviewSettings,
} from "../controllers/reviewSettings.controller";

const router = Router();

router.get("/", getReviewSettings);
router.put("/", saveReviewSettings);
router.delete("/", resetReviewSettings);

export default router;
