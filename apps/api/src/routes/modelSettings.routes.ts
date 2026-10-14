import { Router } from "express";
import {
  checkModelSettings,
  getModelSettings,
  resetModelSettings,
  saveModelSettings,
} from "../controllers/modelSettings.controller";

const router = Router();

router.get("/", getModelSettings);
router.put("/", saveModelSettings);
router.delete("/", resetModelSettings);
router.post("/check", checkModelSettings);

export default router;
