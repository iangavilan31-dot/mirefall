# Portfolio performance repair — October 12, 2026

The first rendered frame previously stalled the page for 5.569 seconds in a 1440×900
headless Edge profile. Texture synthesis also caused 1.590-second and 675-millisecond
main-thread tasks. A passing production build did not catch these freezes.

The texture recipes now run in a module worker. Finished pixel images return to the
existing CanvasTexture cache, with the original color space, repeat and wrapping behavior.
The worker terminates after preparation. Unsupported or failed workers fall back to the
same recipes. A browser test compared complete pixel hashes for bark, wing alpha and
moss between original, worker and compatibility paths; all were identical.

Scene shaders are prepared asynchronously after the actual lantern pool exists. The
water reflection uses shadow-free shader variants, so those are prepared separately.
Postprocessing materials are prepared for their appropriate render targets as well.
The comparable first-render task fell to 271 milliseconds. Controls become available
after preparation rather than appearing immediately before a multi-second freeze.
Total startup was 3.842 seconds before and 5.418 seconds in the final profiled run;
the improvement is responsiveness and reliable readiness, not a claim of faster total
startup. Shared machine load and headless rendering affect absolute timings.

The player interface now uses local licensed fonts, readable menu/settings sizes and
spacing, clearer prompts, visible keyboard focus and settings that fit a 390-pixel screen.
The world palette and combat systems remain those of the original game.

Validation: production build; 37/37 existing playable-loop checks including attacks,
phases, death/restart, victory, ending, quality tiers and checkpoints; separate actual
keyboard/mouse start, movement, attack, pause and settings checks; no JS errors or missing
local resources. Pixel-parity and worker cleanup checks passed. Physical controllers
and a full human playthrough were not validated in this repair.

Technical references: [Three.js WebGLRenderer compileAsync](https://threejs.org/docs/pages/WebGLRenderer.html)
and [MDN OffscreenCanvas bitmap transfer](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/transferToImageBitmap).
