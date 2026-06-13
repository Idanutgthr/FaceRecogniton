const fs = require('fs');
const path = require('path');
const https = require('https');

const BASE_URL = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@latest/model/';
const MODELS = [
  'ssd_mobilenetv1_model-weights_manifest.json',
  'ssd_mobilenetv1_model.bin',
  'face_landmark_68_model-weights_manifest.json',
  'face_landmark_68_model.bin',
  'face_recognition_model-weights_manifest.json',
  'face_recognition_model.bin',
  'tiny_face_detector_model-weights_manifest.json',
  'tiny_face_detector_model.bin'
];

const targetDir = path.join(__dirname, 'public', 'models');

if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        // Handle redirect
        downloadFile(response.headers.location, dest).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to download ${url}: Status Code ${response.statusCode}`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  console.log(`Starting to download models to: ${targetDir}`);
  for (const model of MODELS) {
    const url = `${BASE_URL}${model}`;
    const dest = path.join(targetDir, model);
    console.log(`Downloading ${model}...`);
    try {
      await downloadFile(url, dest);
      console.log(`Success: ${model}`);
    } catch (error) {
      console.error(`Error downloading ${model}:`, error.message);
      process.exit(1);
    }
  }
  console.log('All models downloaded successfully!');
}

main();
