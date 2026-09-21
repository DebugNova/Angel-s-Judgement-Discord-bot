// PM2 process file (VPS without Docker):
//   npm ci && npm run build
//   pm2 start ecosystem.config.cjs && pm2 save && pm2 startup
module.exports = {
  apps: [
    {
      name: 'satan',
      script: 'dist/index.js',
      instances: 1, // exactly one instance — never run the bot twice with the same token
      exec_mode: 'fork',
      autorestart: true,
      max_restarts: 50,
      restart_delay: 5000,
      kill_timeout: 30000,
      max_memory_restart: '400M',
      env: { NODE_ENV: 'production' },
    },
  ],
};
