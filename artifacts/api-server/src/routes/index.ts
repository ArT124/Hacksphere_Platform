import { Router, type IRouter } from "express";
import healthRouter from "./health";
import hackSphereRouter from "./hacksphere";

const router: IRouter = Router();

router.use(healthRouter);
router.use(hackSphereRouter);

export default router;
