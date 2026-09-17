import { sum } from "./sum.mjs";

const got = sum(2, 3);
if (got !== 5) {
  console.error(`FAIL: sum(2, 3) = ${got}, expected 5`);
  process.exit(1);
}
console.log("PASS: sum(2, 3) = 5");
