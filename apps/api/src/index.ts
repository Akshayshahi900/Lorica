import "dotenv/config"; // MUST be the first import — before githubRoutes

import express from "express";
import githubRoutes from "./routes/github.routes";
import pullRequestRoutes from "./routes/pr.routes";

const app = express();

app.use("/webhooks", express.raw({ type: "application/json" }), githubRoutes);
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Home");
});
app.get("/health", (req, res) => {
  res.send("OK");
});

app.use("/api/pulls", pullRequestRoutes);
app.use((req, res, next) => {
  console.log(">>>", req.method, req.url);
  next();
});

app.listen(5000, () => {
  console.log("Listening on 5000");
});