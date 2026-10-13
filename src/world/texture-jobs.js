export const textureJobs = [
  ['bark', 512], ['plank', 512], ['thatch', 512], ['mushroomCap', 512],
  ['moss', 512], ['skin', 512], ['cloth', 256], ['steel', 256],
  ['wingMembrane', 1024], ['lilypad', 256],
  ['glowSprite', 128, 2.2], ['glowSprite', 64, 2.2],
  ...[12, 27, 41, 55, 68].map(seed => ['fogSheet', 256, seed]),
  ...[30, 31, 32, 33, 34, 35, 36, 71].map(seed => ['mossCurtain', 256, seed]),
];
