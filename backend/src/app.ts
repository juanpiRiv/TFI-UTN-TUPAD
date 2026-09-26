import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { authRouter } from './module/auth/auth.routes.js';
import { error } from 'node:console';
import { errorHandler } from './middlewares/error-handler.js';
import { organizationsRouter } from './module/organizations/organizations.routes.js';


export const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get("/test", (_req, res) => {
    res.json({ status: 'ok' });
});

app.use("/api/auth", authRouter);
app.use("/api/organizations", organizationsRouter);


app.use((_req, res) => {
    res.status(404).json({ error: "URL not found" })
});

app.use(errorHandler);