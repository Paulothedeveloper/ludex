import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve } from "path";

const src = resolve("icon-source.svg");
const out = resolve("icon-1024.png");

const svg = readFileSync(src);
await sharp(svg, { density: 384 })
  .resize(1024, 1024)
  .png({ compressionLevel: 9 })
  .toFile(out);
console.log("OK ->", out);
