import { config } from "../config.js";
import { createPool } from "./pool.js";
import { migrate, seed } from "./setup.js";
const pool = createPool(config.databaseUrl);
try {
  if (process.argv[2] === "seed") await seed(pool);
  else await migrate(pool);
  console.log("Готово");
} finally {
  await pool.end();
}
