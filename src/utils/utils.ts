import sharp from 'sharp';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getRandomInt(min: number, max: number) {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generateRandomFileName() {
    return getRandomInt(1600000000000000, 1800000000000000); //mimic 4chanx ts
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function createAndModifyTempImage(originalFilePath: string) {
    const randomFileName = generateRandomFileName() + path.extname(originalFilePath);

    const tempFilePath = path.join(__dirname, randomFileName);
  
    // Read the original image
    const imageBuffer = await fs.readFile(originalFilePath);
  
    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
  
    // Generate random coordinates
    const x = Math.floor(Math.random() * (metadata.width ?? 0));
    const y = Math.floor(Math.random() * (metadata.height ?? 0));
  
    // Create a 4x4 pixel overlay
    const overlay = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 4,
        background: { r: Math.floor(Math.random() * 255), g: 255, b: 255, alpha: 0.5 }
      }
    }).png().toBuffer();
  
    // Modify the image by overlaying the pixel
    const modifiedImageBuffer = await sharp(imageBuffer)
      .composite([
        { input: overlay, left: x, top: y }
      ])
      .toBuffer();
  
    await fs.writeFile(tempFilePath, modifiedImageBuffer);
  
    return tempFilePath;
}