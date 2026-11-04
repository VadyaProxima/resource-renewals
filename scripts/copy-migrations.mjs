import { cp } from "node:fs/promises";
await cp("migrations", "dist/apps/api/migrations", { recursive: true });
