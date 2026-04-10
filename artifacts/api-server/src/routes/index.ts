import { Router, type IRouter } from "express";
import healthRouter from "./health";
import industriesRouter from "./industries";
import capabilitiesRouter from "./capabilities";
import organizationsRouter from "./organizations";
import dashboardRouter from "./dashboard";
import projectsRouter from "./projects";
import insightsRouter from "./insights";
import ceiRouter from "./cei";

const router: IRouter = Router();

router.use(healthRouter);
router.use(industriesRouter);
router.use(capabilitiesRouter);
router.use(organizationsRouter);
router.use(dashboardRouter);
router.use(projectsRouter);
router.use(insightsRouter);
router.use(ceiRouter);

export default router;
