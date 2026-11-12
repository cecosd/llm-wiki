// Копирането може да е гигабайти: върви в отделна нишка, за да не замръзва интерфейсът. Напредъкът се връща със съобщения.
import { parentPort, workerData } from 'node:worker_threads';
import * as sync from './sync.js';

sync.onProgress((p) => parentPort.postMessage({ progress: p }));
const { op, args } = workerData;
const fn = { plan: sync.plan, run: sync.run, verify: sync.verify }[op];
let result;
try { result = fn ? fn(...args) : { ok: false, error: 'unknown' }; } catch (e) { result = { ok: false, error: e.message }; }
parentPort.postMessage({ result });
