import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tensorflow = fs.readFileSync(path.join(__dirname, 'tensorflow.js'), 'utf8');
const wasm = fs.readFileSync(path.join(__dirname, 'wasm.js'), 'utf8');
const solverWASM = fs.readFileSync(path.join(__dirname, 'solverWASM.js'), 'utf8');

const SOLVER = `${tensorflow}\n${wasm}\n${solverWASM}`;
export default SOLVER;