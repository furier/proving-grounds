import { snakeCase } from "change-case";
import assert from 'node:assert/strict';

console.log("Running tests...");

// a failed assert will print error and make the process return a non-zero exit code.
assert(snakeCase("Hello, world!") == "HelloWorld");

