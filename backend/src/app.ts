import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './module/auth/auth.routes.js';
import { clientsRouter } from './module/clients/clients.routes.js';
import { transactionsRouter } from './module/transactions/transactions.routes.js';
import { dashboardRouter } from './module/dashboard/dashboard.routes.js';
import { exchangeRatesRouter } from './module/exchange-rates/exchange-rates.routes.js';
import { invoicesRouter } from './module/invoices/invoices.routes.js';
import { paymentsRouter } from './module/payments/payments.routes.js';
import { errorHandler } from './middlewares/error-handler.js';
import { env } from './config/env.js';
import { organizationsRouter } from './module/organizations/organizations.routes.js';


export const app = express();

app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN ? env.CORS_ORIGIN.split(",") : true }));
app.use(express.json());

app.get("/test", (_req, res) => {
    res.json({ status: 'ok' });
});

app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);
app.use("/api/clients", clientsRouter);
app.use("/api/transactions", transactionsRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/exchange-rates", exchangeRatesRouter);
app.use("/api/invoices", paymentsRouter);
app.use("/api/invoices", invoicesRouter);


app.use((_req, res) => {
    res.status(404).json({ error: "URL not found" })
});

app.use(errorHandler);