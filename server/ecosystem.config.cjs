/** PM2: pm2 start ecosystem.config.cjs */
module.exports = {
  apps: [
    {
      name: 'salescompanion-api',
      cwd: __dirname,
      script: 'dist/index.js',
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        HOST: '0.0.0.0',
        PORT: 8787,
      },
    },
  ],
}
