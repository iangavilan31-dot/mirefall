import * as textures from './TextureLab.js';
import { textureJobs } from './texture-jobs.js';

self.onmessage = () => {
  try {
    textureJobs.forEach(([name, ...args], index) => {
      textures[name](...args);
      self.postMessage({ progress: (index + 1) / textureJobs.length });
    });
    const { entries, transfers } = textures.transferTextureCache();
    self.postMessage({ entries }, transfers);
  } catch (error) {
    self.postMessage({ error: error.message || String(error) });
  }
};
