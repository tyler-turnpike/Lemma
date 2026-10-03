#!/usr/bin/env node
import { runOrExit, startStdioBridge } from "./main.js";

runOrExit(() => startStdioBridge());
