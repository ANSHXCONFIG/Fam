import dotenv from "dotenv";
dotenv.config();
import { pool } from "./db.js";
import fs from "node:fs/promises";

const sql = await fs.readFile(new URL("./schema.sql", import.meta.url), "utf8");
await pool.query(sql);
console.log("Database schema initialized.");
await pool.end();
