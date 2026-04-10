import { Router, type IRouter } from "express";
import healthRouter from "./health";
import industriesRouter from "./industries";
import capabilitiesRouter from "./capabilities";
import organizationsRouter from "./organizations";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(industriesRouter);
router.use(capabilitiesRouter);
router.use(organizationsRouter);
router.use(dashboardRouter);

export default router;
