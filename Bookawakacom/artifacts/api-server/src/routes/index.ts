import { Router, type IRouter } from "express";
import healthRouter from "./health";
import contactRouter from "./contact";
import companiesRouter from "./companies";
import bookingsRouter from "./bookings";
import registerRouter from "./register";
import jobRouter from "./job";
import myRidesRouter from "./myrides";
import appSettingsRouter from "./app-settings";
import towRouter from "./tow";
import stripeRouter from "./stripe";
import paymentConfigRouter from "./payment-config";
import tariffsRouter from "./tariffs";
import fareEstimateRouter from "./fare-estimate";
import restaurantsRouter from "./restaurants";
import verifyPaymentRouter from "./verify-payment";
import geocodeRouter from "./geocode";
import adminWalletRouter from "./admin-wallet";
import cancelRouter from "./cancel";
import bookingRouter from "./booking";

const router: IRouter = Router();

router.use(healthRouter);
router.use(contactRouter);
router.use(companiesRouter);
router.use(bookingsRouter);
router.use(registerRouter);
router.use(jobRouter);
router.use(myRidesRouter);
router.use(appSettingsRouter);
router.use(towRouter);
router.use(stripeRouter);
router.use(paymentConfigRouter);
router.use(tariffsRouter);
router.use(fareEstimateRouter);
router.use(restaurantsRouter);
router.use(verifyPaymentRouter);
router.use(geocodeRouter);
router.use(adminWalletRouter);
router.use(cancelRouter);
// Passenger-app create/cancel/edit + notify-booking (fixes live /api/booking/* 404).
router.use(bookingRouter);

export default router;
