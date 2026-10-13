import * as textures from './TextureLab.js';
import { textureJobs } from './texture-jobs.js';

export async function prepareTextures(onProgress) {
  if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
    try {
      await new Promise((resolve, reject) => {
        const worker = new Worker(new URL('./texture.worker.js', import.meta.url), { type: 'module' });
        const timeout = setTimeout(() => finish(new Error('Texture preparation timed out')), 120000);
        const finish = (error) => {
          clearTimeout(timeout); worker.terminate();
          error ? reject(error) : resolve();
        };
        worker.onerror = event => { event.preventDefault(); finish(new Error(event.message)); };
        worker.onmessage = ({ data }) => {
          if (data.error) return finish(new Error(data.error));
          if (data.progress !== undefined) onProgress(data.progress);
          if (data.entries) {
            try { textures.restoreTextureCache(data.entries); finish(); }
            catch (error) { finish(error); }
          }
        };
        worker.postMessage({ start: true });
      });
      return 'worker';
    } catch (error) {
      console.warn('Using compatible texture preparation:', error.message);
    }
  }
  // Older browsers still get the same artwork. Yield between recipes so progress paints.
  for (let i = 0; i < textureJobs.length; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    const [name, ...args] = textureJobs[i];
    textures[name](...args); onProgress((i + 1) / textureJobs.length);
  }
  return 'compatible';
}
