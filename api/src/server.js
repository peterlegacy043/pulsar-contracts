import express from "express";
import { randomUUID } from "crypto";
import { errorMiddleware } from "./middleware/errors.js";
import { auditMiddleware } from "./middleware/audit.js";
import merchantsRouter from "./routes/merchants.js";
import paymentsRouter from "./routes/payments.js";

export function buildCorsOptions(env = process.env) {
  const nodeEnv = env.NODE_ENV || "development";
  const isProduction = nodeEnv === "production";

// Attach a request ID to every request for inclusion in error responses.
app.use((req, res, next) => {
  req.id = req.headers["x-request-id"] || randomUUID();
  res.setHeader("x-request-id", req.id);
  next();
});

app.use(express.json());

  if (!isProduction) {
    // Development: allow all origins.
    return {
      origin: true,
      credentials: true,
    };
  }

// 404 handler for unmatched routes, using the standard error format.
app.use((req, res, next) => {
  const err = new Error("Not Found");
  err.status = 404;
  err.code = "NOT_FOUND";
  next(err);
});

// Shared error middleware must be registered last, after all routes.
app.use(errorMiddleware);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Pulsar API running on port ${PORT}`));