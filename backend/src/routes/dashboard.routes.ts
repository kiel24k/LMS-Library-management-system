import { Router } from "express";
import { z } from "zod";
import { getQuery, validateQuery } from "../middleware/validate.js";
import { requirePermission } from "../middleware/auth.js";
import { queryStr } from "../lib/validation.js";
import { getDashboard } from "../services/dashboard.service.js";

const dashboardQuery = z.object({ libraryId: queryStr(64) });

export function dashboardRouter() {
  const r = Router();
  r.get("/", requirePermission("dashboard.view"), validateQuery(dashboardQuery), async (_req, res) => {
    res.json(await getDashboard(getQuery<typeof dashboardQuery>(res).libraryId));
  });
  return r;
}
