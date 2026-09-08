import { defineConfig, env } from "prisma/config";
import dotenv from "dotenv";

dotenv.config({
  path: "../../apps/api/.env",
});

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});